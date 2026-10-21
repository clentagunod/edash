import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function EduAiMessageContent({ content }: { content: string }) {
  return (
    <div className="eduai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
