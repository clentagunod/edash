# San Roque School Assets

Keep San Roque-specific branding in this directory:

- `logo.png` — school logo
- `video.mp4` — school login video; keep it compressed and optimized for web playback

After adding the files, set the San Roque school registration fields in the
central school directory to:

```json
{
  "logoUrl": "/assets/san-roque/logo.png",
  "videoUrl": "/assets/san-roque/video.mp4"
}
```

The E-Dash-wide logo and introduction video remain in `../edash/`.
Videos are requested only when their display area approaches the viewport.
Vercel caches MP4 assets for one day and may serve a stale copy while
revalidating, so use a new filename when replacing a video for immediate rollout.
