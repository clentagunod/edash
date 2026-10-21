import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EduAiProviderCatalog from './EduAiProviderCatalog';

describe('EduAiProviderCatalog', () => {
  it('lists paid providers with official pricing links and Ollama as a local option', () => {
    const markup = renderToStaticMarkup(createElement(EduAiProviderCatalog));

    for (const provider of ['OpenAI', 'Google Gemini', 'Anthropic Claude', 'DeepSeek', 'Mistral AI', 'xAI Grok', 'OpenRouter']) {
      expect(markup).toContain(provider);
    }
    expect(markup).toContain('Paid &amp; Pro AI agents');
    expect(markup).toContain('https://developers.openai.com/api/docs/pricing');
    expect(markup).toContain('https://ai.google.dev/gemini-api/docs/pricing');
    expect(markup).toContain('https://platform.claude.com/docs/en/about-claude/pricing');
    expect(markup).toContain('https://api-docs.deepseek.com/quick_start/pricing');
    expect(markup).toContain('https://mistral.ai/pricing');
    expect(markup).toContain('https://docs.x.ai/developers/models');
    expect(markup).toContain('https://openrouter.ai/pricing');
    expect(markup).toContain('Local AI option');
    expect(markup).toContain('Ollama');
    expect(markup).toContain('https://ollama.com/');
    expect(markup).toContain('Rates, credits, plan limits, and model availability can change');
  });
});
