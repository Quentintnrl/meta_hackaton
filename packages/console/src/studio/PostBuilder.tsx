import { useEffect, useRef, useState } from 'react';
import { contentApi, type ContentItem, type Media, type MediaFormat, type Slide } from '../api';
import { useAction } from './shared';

const FORMATS: Array<[MediaFormat, string, string]> = [['image', 'Image', 'One picture'], ['carousel', 'Carousel', 'A series of pictures'], ['video', 'Video', 'Short video: storyboard']];
const blank = (video: boolean): Slide => ({ kind: video ? 'video' : 'image', visual: '', text: '', seconds: video ? 5 : 0 });

// A post is more than a picture: the media (one image, a carousel or a video storyboard), the description, the hashtags.
export function PostBuilder({ item, reload }: { item: ContentItem; reload: () => Promise<void> }) {
  const saved = item.media;
  const [media, setMedia] = useState<Media | undefined>(saved);
  const [tags, setTags] = useState((saved?.hashtags ?? []).join(' '));
  const { busy, error, run } = useAction(reload);
  const [stamp, setStamp] = useState(0); // 0 = no video assembled yet
  useEffect(() => { setStamp(0); fetch(contentApi.videoUrl(item.id, 0), { method: 'HEAD' }).then(r => r.ok && setStamp(Date.now())).catch(() => {}); }, [item.id]);
  useEffect(() => { setMedia(item.media); setTags((item.media?.hashtags ?? []).join(' ')); }, [item.id, item.media]);

  if (!media) return <p className="hint small">No media yet: have the post written, or <button className="linkish" onClick={() => setMedia({ format: 'image', hashtags: [], slides: [blank(false)] })}>build it by hand</button>.</p>;
  // Same cleanup as the server (normalizeHashtags): strip odd characters,
  // add the #, drop duplicates, keep 20. The preview shows what is saved.
  const hashtags = (() => {
    const out: string[] = [];
    for (const t of tags.split(/[\s,]+/).filter(Boolean)) {
      const clean = t.replace(/[^\p{L}\p{N}_]/gu, '');
      if (clean && !out.some(o => o.toLowerCase() === `#${clean}`.toLowerCase())) out.push(`#${clean}`);
    }
    return out.slice(0, 20);
  })();
  const edited: Media = { ...media, hashtags };
  const dirty = JSON.stringify(edited) !== JSON.stringify(saved);
  const b = busy !== '';
  const video = media.format === 'video';
  const setSlide = (i: number, patch: Partial<Slide>) => setMedia({ ...media, slides: media.slides.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const setFormat = (format: MediaFormat) => {
    // Switching to one image drops the other slides: ask first when that loses work.
    if (format === 'image' && media.slides.length > 1 && media.slides.slice(1).some(x => x.visual.trim() || x.text.trim() || x.file)) {
      if (!window.confirm(`Switching to a single image drops the other ${media.slides.length - 1} slides. Continue?`)) return;
    }
    const v = format === 'video';
    let slides = media.slides.map(x => ({ ...x, kind: v ? 'video' as const : 'image' as const, seconds: v ? x.seconds || 5 : 0 }));
    if (format === 'image') slides = slides.slice(0, 1);
    if (format !== 'image' && slides.length < 2) slides = [...slides, blank(v)];
    setMedia({ ...media, format, slides });
  };
  const missing = media.slides.filter(x => !x.file && x.visual.trim()).length;
  // The manager's own photo on a slide: read in the browser, sent as base64, kept like a generated one.
  const pick = useRef<HTMLInputElement | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const choose = (i: number) => { setPicking(i); pick.current?.click(); };
  const onFile = (f: File | undefined) => {
    const i = picking; setPicking(null);
    if (!f || i == null) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { alert('Use a JPEG, PNG or WebP picture.'); return; }
    if (f.size > 8 * 1024 * 1024) { alert('8 MB at most.'); return; }
    const r = new FileReader();
    r.onload = () => { const data = String(r.result).split(',')[1] ?? ''; void run(`up${i}`, () => contentApi.uploadSlide(item.id, i, f.type, data)); };
    r.readAsDataURL(f);
  };

  return (
    <div className="post">
      <div className="fmt" role="radiogroup" aria-label="Post format">
        {FORMATS.map(([f, name, hint]) => <button key={f} role="radio" aria-checked={media.format === f} className={media.format === f ? 'on' : ''} title={hint} onClick={() => setFormat(f)}>{name}</button>)}
      </div>

      <div className={`slides ${video ? 'video' : ''}`}>
        {media.slides.map((x, i) => (
          <div key={i} className="slide">
            <div className={`frame ${video ? 'tall' : ''}`}>
              {x.file ? <img src={contentApi.mediaUrl(item.id, x.file)} alt={`${video ? 'Shot' : 'Slide'} ${i + 1}`} /> : <span>{video ? 'Keyframe' : 'Picture'} not generated</span>}
              {x.file && x.text && <i className="pv-text">{x.text}</i>}
              <em>{i + 1}</em>
            </div>
            <label>{video ? 'What we see' : 'Picture to generate'}<textarea rows={3} value={x.visual} onChange={e => setSlide(i, { visual: e.target.value })} /></label>
            <label>{video ? 'Voiceover / on-screen text' : 'Text over the picture'}<input value={x.text} onChange={e => setSlide(i, { text: e.target.value })} /></label>
            <div className="row">
              {video && <label className="inline sec"><span>Seconds</span><input type="number" min={1} max={90} value={x.seconds} onChange={e => setSlide(i, { seconds: Number(e.target.value) })} /></label>}
              <button disabled={b || dirty || !x.visual.trim()} title={dirty ? 'Save your changes first' : !x.visual.trim() ? 'Describe the picture first' : 'One paid image generation, about 20 seconds'} onClick={() => run(`gen${i}`, () => contentApi.generateSlide(item.id, i))}>{busy === `gen${i}` ? 'Drawing…' : x.file ? 'Redraw' : video ? 'Generate keyframe' : 'Generate picture'}</button>
              <button className="linkish" disabled={b || dirty} title={dirty ? 'Save your changes first' : 'Your own photo instead of a generated one: no model call'} onClick={() => choose(i)}>{busy === `up${i}` ? 'Uploading…' : 'Use my photo'}</button>
              {media.slides.length > (media.format === 'image' ? 1 : 2) && <button className="linkish" onClick={() => setMedia({ ...media, slides: media.slides.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          </div>
        ))}
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        {media.format !== 'image' && media.slides.length < 10 && <button className="slide add-slide" onClick={() => setMedia({ ...media, slides: [...media.slides, blank(video)] })}>+ {video ? 'Add a shot' : 'Add a slide'}</button>}
      </div>
      {video && (
        <div className="videobox">
          {stamp > 0 ? <video controls playsInline src={contentApi.videoUrl(item.id, stamp)} /> : <VideoUnavailable />}
          <div>
            <b>{stamp > 0 ? 'Your slideshow' : 'AI video: not available yet'}</b>
            <p className="hint small">{stamp > 0 ? 'Assembled from the keyframes on your computer.' : 'Meta has not opened video generation on your key yet. As soon as it does, it will appear here.'}</p>
            <button disabled={b || dirty || missing > 0 || media.slides.some(x => !x.file)} title={dirty ? 'Save your changes first' : missing > 0 ? 'Generate the missing keyframes first' : ''} onClick={() => run('video', async () => { await contentApi.renderVideo(item.id); setStamp(Date.now()); })}>{busy === 'video' ? 'Assembling…' : stamp > 0 ? 'Re-assemble the slideshow' : 'Assemble a slideshow instead'}</button>
            {stamp === 0 && <span className="hint small">Free: a local montage of your keyframes, with zoom and text. Not AI-generated.</span>}
          </div>
        </div>
      )}

      <label>Hashtags<input value={tags} onChange={e => setTags(e.target.value)} placeholder="#mealprep #solodev" /></label>
      <div className="chips">{hashtags.map(h => <span key={h} className="pill">{h}</span>)}{hashtags.length >= 20 && <span className="hint small">20 max, the rest is dropped</span>}</div>

      <div className="row">
        {dirty && <button className="primary" disabled={b} onClick={() => run('savemedia', () => contentApi.patchItem(item.id, { media: edited }))}>Save media</button>}
        {!dirty && missing > 0 && <button disabled={b} onClick={() => run('genall', () => contentApi.generateMissing(item.id))}>{busy === 'genall' ? 'Drawing…' : `Generate ${missing} missing picture${missing > 1 ? 's' : ''}`}</button>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// What it will look like in a feed: every slide or shot (not just the
// first), its words, the description, the hashtags.
export function PostPreview({ item }: { item: ContentItem }) {
  const m = item.media;
  if (!m) return null;
  const first = m.slides.find(s => s.file);
  return (
    <div className="preview" aria-label="Preview">
      <div className={`pv-media ${m.format === 'video' ? 'tall' : ''}`}>
        {first ? <img src={contentApi.mediaUrl(item.id, first.file!)} alt="" /> : <span>No picture yet</span>}
        {m.format !== 'image' && <b className="pv-tag">{m.format === 'video' ? `▶ ${m.slides.reduce((a, s) => a + s.seconds, 0)}s` : `1/${m.slides.length}`}</b>}
        {first && first.text && <i className="pv-text">{first.text}</i>}
      </div>
      {m.format !== 'image' && (
        <ol className="pv-shots">{m.slides.map((s, i) => (
          <li key={i} className={s.file ? 'done' : ''}>
            <b>{m.format === 'video' ? `Shot ${i + 1} · ${s.seconds}s` : `Slide ${i + 1}`}</b>
            <span>{s.file ? (s.text || 'No words on this one') : 'Not generated yet'}</span>
          </li>
        ))}</ol>
      )}
      <p className="pv-caption">{item.draft}</p>
      <p className="pv-tags">{m.hashtags.join(' ')}</p>
    </div>
  );
}

// A small picture standing in for the video the AI cannot make yet.
function VideoUnavailable() {
  return (
    <svg className="unavail" viewBox="0 0 90 160" role="img" aria-label="AI video not available yet">
      <rect x="1.5" y="1.5" width="87" height="157" rx="12" className="u-frame" />
      <path d="M36 62 L58 76 L36 90 Z" className="u-play" />
      <line x1="22" y1="40" x2="68" y2="120" className="u-bar" />
      <rect x="18" y="128" width="54" height="14" rx="7" className="u-tag" />
      <text x="45" y="138" textAnchor="middle" className="u-text">soon</text>
    </svg>
  );
}
