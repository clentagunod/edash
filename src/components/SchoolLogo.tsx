import { useEffect, useRef, useState } from 'react';
import { cachedSchoolLogoSource, rejectCachedSchoolLogo } from '../lib/school-logo-cache';
import '../styles/components/school-logo.css';

interface SchoolLogoProps { name: string; logoUrl?: string; active?: boolean; className?: string }

/** Decorative branding; load only when the picker is open and this row is visible. */
export default function SchoolLogo({ name, logoUrl = '', active = true, className = '' }: SchoolLogoProps) {
  const container = useRef<HTMLSpanElement>(null);
  const [image, setImage] = useState<{ url: string; source: string | null }>({ url: '', source: null });
  const source = image.url === logoUrl ? image.source : null;
  useEffect(() => {
    if (!active || !logoUrl.trim()) return;
    let current = true;
    const load = () => {
      void cachedSchoolLogoSource(logoUrl).then(source => { if (current) setImage({ url: logoUrl, source }); }, () => {
        if (current) setImage({ url: logoUrl, source: null });
      });
    };
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined' && container.current) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
      });
      observer.observe(container.current);
    } else load();
    return () => { current = false; observer?.disconnect(); };
  }, [logoUrl, active]);
  return <span ref={container} className={`school-logo ${className}`} aria-hidden="true">
    {source ? <img key={source} src={source} alt="" width="36" height="36" decoding="async" referrerPolicy="no-referrer" onError={() => {
      rejectCachedSchoolLogo(logoUrl); setImage({ url: logoUrl, source: null });
    }} /> : <span className="school-logo-initials">{name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('')}</span>}
  </span>;
}
