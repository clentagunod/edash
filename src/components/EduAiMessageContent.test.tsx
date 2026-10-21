import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EduAiMessageContent from './EduAiMessageContent';

describe('EduAiMessageContent', () => {
  it('renders markdown structure instead of exposing formatting markers', () => {
    const markup = renderToStaticMarkup(createElement(EduAiMessageContent, {
      content: '## Summary\n\n**Key point**\n\n- First item\n- Second item',
    }));

    expect(markup).toContain('<h2>Summary</h2>');
    expect(markup).toContain('<strong>Key point</strong>');
    expect(markup).toContain('<li>First item</li>');
    expect(markup).not.toContain('**Key point**');
  });

  it('renders GFM tables and does not interpret raw HTML', () => {
    const markup = renderToStaticMarkup(createElement(EduAiMessageContent, {
      content: '| Grade | Count |\n| --- | ---: |\n| Grade 1 | 24 |\n\n<script>alert(1)</script>',
    }));

    expect(markup).toContain('<table>');
    expect(markup).toContain('<th style="text-align:right">Count</th>');
    expect(markup).not.toContain('<script>');
  });
});
