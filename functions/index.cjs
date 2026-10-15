const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

initializeApp();

const MAX_USER_IDS = 1000;

function isAuthPermissionError(error) {
  return ["auth/insufficient-permission", "auth/insufficient-permissions"].includes(error?.code);
}

function permissionError() {
  return new HttpsError(
    "failed-precondition",
    "The deleteAuthUsers function runtime account needs the Firebase Authentication Admin role.",
  );
}

exports.deleteAuthUsers = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in before removing user accounts.");
  }

  const callerId = request.auth.uid;
  const callerSnapshot = await getFirestore().collection("users").doc(callerId).get();
  const caller = callerSnapshot.data();
  if (!callerSnapshot.exists || caller?.role !== "School Admin" || caller?.status !== "Active") {
    throw new HttpsError("permission-denied", "Only an active School Admin can remove user accounts.");
  }

  const requestedIds = request.data?.userIds;
  if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.length > MAX_USER_IDS) {
    throw new HttpsError("invalid-argument", `Select between 1 and ${MAX_USER_IDS} users to remove.`);
  }

  const userIds = [...new Set(requestedIds.map((id) => typeof id === "string" ? id.trim() : ""))];
  if (userIds.some((id) => !id || id.length > 128 || id.includes("/"))) {
    throw new HttpsError("invalid-argument", "One or more user IDs are invalid.");
  }
  if (userIds.includes(callerId)) {
    throw new HttpsError("permission-denied", "You cannot remove your own account.");
  }

  try {
    const result = await getAuth().deleteUsers(userIds);
    const failures = result.errors.filter((entry) => entry.error.code !== "auth/user-not-found");

    if (failures.length > 0) {
      if (failures.some((entry) => isAuthPermissionError(entry.error))) {
        console.error("Firebase Authentication account deletion lacks required permissions.", {
          errorCodes: failures.map((entry) => entry.error.code),
        });
        throw permissionError();
      }
      console.error("Firebase Authentication could not delete all requested accounts.", {
        errorCodes: failures.map((entry) => entry.error.code),
      });
      throw new HttpsError(
        "internal",
        `Firebase Authentication could not remove ${failures.length} selected account(s).`,
        { failedUserIds: failures.map((entry) => userIds[entry.index]) },
      );
    }

    return { deletedUserIds: userIds };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (isAuthPermissionError(error)) {
      console.error("Firebase Authentication account deletion lacks required permissions.", error);
      throw permissionError();
    }
    console.error("Firebase Authentication account deletion failed.", error);
    throw new HttpsError(
      "internal",
      "Firebase Authentication could not remove the selected accounts. Check the deleteAuthUsers Cloud Function logs.",
    );
  }
});