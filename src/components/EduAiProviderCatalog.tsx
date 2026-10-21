import type { CSSProperties } from 'react';
import {
  siAnthropic,
  siDeepseek,
  siGooglegemini,
  siMistralai,
  siOllama,
  siOpenrouter,
  type SimpleIcon,
} from 'simple-icons';

interface ProviderOption {
  name: string;
  category: string;
  description: string;
  pricingUrl: string;
  providerUrl: string;
  icon?: SimpleIcon;
  wordmark?: string;
}

const paidProviders: ProviderOption[] = [
  {
    name: 'OpenAI',
    category: 'Hosted models · API usage pricing',
    description: 'GPT models for chat, reasoning, and multimodal workloads.',
    pricingUrl: 'https://developers.openai.com/api/docs/pricing',
    providerUrl: 'https://platform.openai.com/',
    wordmark: 'OpenAI',
  },
  {
    name: 'Google Gemini',
    category: 'Hosted models · free and paid API tiers',
    description: 'Gemini models with usage-based API pricing and model-specific limits.',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    providerUrl: 'https://aistudio.google.com/',
    icon: siGooglegemini,
  },
  {
    name: 'Anthropic Claude',
    category: 'Hosted models · API and subscription plans',
    description: 'Claude models with token-based API rates and separate Claude plans.',
    pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
    providerUrl: 'https://claude.com/pricing',
    icon: siAnthropic,
  },
  {
    name: 'DeepSeek',
    category: 'Hosted models · API usage pricing',
    description: 'DeepSeek models with model-specific token rates and cache pricing.',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    providerUrl: 'https://platform.deepseek.com/',
    icon: siDeepseek,
  },
  {
    name: 'Mistral AI',
    category: 'Hosted models · API usage pricing',
    description: 'Mistral models with per-token pricing; available models and rates vary.',
    pricingUrl: 'https://mistral.ai/pricing',
    providerUrl: 'https://console.mistral.ai/',
    icon: siMistralai,
  },
  {
    name: 'xAI Grok',
    category: 'Hosted models · API usage pricing',
    description: 'Grok models with usage rates based on model and token type.',
    pricingUrl: 'https://docs.x.ai/developers/models',
    providerUrl: 'https://x.ai/api',
    wordmark: 'xAI',
  },
  {
    name: 'OpenRouter',
    category: 'Multi-provider · model-dependent rates',
    description: 'One API to compare models from many providers; model prices and platform fees vary.',
    pricingUrl: 'https://openrouter.ai/pricing',
    providerUrl: 'https://openrouter.ai/models',
    icon: siOpenrouter,
  },
];

const localProvider: ProviderOption = {
  name: 'Ollama',
  category: 'Local AI · runs on your computer',
  description: 'Run supported open models locally. No per-token API charge for local inference; hardware and electricity still matter.',
  pricingUrl: 'https://ollama.com/',
  providerUrl: 'https://ollama.com/',
  icon: siOllama,
};

function ProviderCard({ provider, local = false }: { provider: ProviderOption; local?: boolean }) {
  const { icon } = provider;
  return (
    <article className={`eduai-provider-card${local ? ' is-local' : ''}`}>
      <div className="eduai-provider-heading">
        <span
          className="eduai-provider-logo"
          style={{ '--provider-color': icon?.hex === '191919' ? 'var(--ink-900)' : `#${icon?.hex || '101828'}` } as CSSProperties}
        >
          {icon ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={icon.path} />
            </svg>
          ) : (
            <span className={`eduai-provider-wordmark${provider.wordmark === 'xAI' ? ' is-xai' : ''}`}>
              {provider.wordmark}
            </span>
          )}
        </span>
        <div>
          <h4>{provider.name}</h4>
          <span>{provider.category}</span>
        </div>
      </div>
      <p>{provider.description}</p>
      <div className="eduai-provider-actions">
        <a href={provider.pricingUrl} target="_blank" rel="noreferrer">
          {local ? 'Visit Ollama' : 'Official pricing'}
          <span aria-hidden="true">↗</span>
        </a>
        {!local && (
          <a className="eduai-provider-secondary-link" href={provider.providerUrl} target="_blank" rel="noreferrer">
            Provider site
          </a>
        )}
      </div>
    </article>
  );
}

export default function EduAiProviderCatalog() {
  return (
    <div className="eduai-provider-catalog">
      <div className="eduai-provider-catalog-heading">
        <div>
          <span className="eduai-access-label">Explore your options</span>
          <h3>AI agents and providers</h3>
          <p>Compare official pricing and plans before choosing a service.</p>
        </div>
      </div>
      <section className="eduai-provider-section" aria-labelledby="eduai-paid-providers">
        <h4 id="eduai-paid-providers">Paid &amp; Pro AI agents</h4>
        <div className="eduai-provider-grid">
          {paidProviders.map((provider) => <ProviderCard key={provider.name} provider={provider} />)}
        </div>
      </section>
      <section className="eduai-provider-section" aria-labelledby="eduai-local-providers">
        <h4 id="eduai-local-providers">Local AI option</h4>
        <div className="eduai-provider-grid eduai-provider-grid-local">
          <ProviderCard provider={localProvider} local />
        </div>
      </section>
      <p className="eduai-provider-disclaimer">
        Rates, credits, plan limits, and model availability can change; check each provider’s official page.
        These links are for reference only and do not purchase a plan or connect that provider to E-Dash.
      </p>
    </div>
  );
}
