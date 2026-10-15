import LegacyPage from './LegacyPage';
import html from './markup/transfer-info.html?raw';
import { requireAuth } from '../lib/auth';
import { initTransferInfo } from '../lib/transfer-info';

export default function TransferInfoPage() {
  return (
    <LegacyPage
      html={html}
      title="Transfer Info"
      onMount={async () => {
        await requireAuth();
    await initTransferInfo();
        
      }}
    />
  );
}
