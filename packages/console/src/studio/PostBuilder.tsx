import { useEffect, useState } from 'react';
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
  useEffect(() => { setMedia(item.media); setTags((item.media?.hashtags ?? []).join(' ')); }, [item.id, item.media]);

  if (!media) return <p className="hint small">No media yet: have the post written, or <button className="linkish" onClick={() => setMedia({ format: 'image', hashtags: [], slides: [blank(false)] })}>build it by hand</button>.</p>;
  const hashtags = tags.split(/[\s,]+/).filter(Boolean);
  const edited: Media = { ...media, hashtags };
  const dirty = JSON.stringify(edited) !== JSON.stringify(saved);
  const b = busy !== '';
  const video = media.format === 'video';
  const setSlide = (i: number, patch: Partial<Slide>) => setMedia({ ...media, slides: media.slides.map((x, j) => j === i ? { ...x, ...patch } : x) });
  const setFormat = (format: MediaFormat) => {
    const v = format === 'video';
    let slides = media.slides.map(x => ({ ...x, kind: v ? 'video' as const : 'image' as const, seconds: v ? x.seconds || 5 : 0 }));
    if (format === 'image') slides = slides.slice(0, 1);
    if (format !== 'image' && slides.length < 2) slides = [...slides, blank(v)];
    setMedia({ ...media, format, slides });
  };
  const missing = media.slides.filter(x => !x.file && x.visual.trim()).length;

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
              <em>{i + 1}</em>
            </div>
            <label>{video ? 'What we see' : 'Picture to generate'}<textarea rows={3} value={x.visual} onChange={e => setSlide(i, { visual: e.target.value })} /></label>
            <label>{video ? 'Voiceover / on-screen text' : 'Text over the picture'}<input value={x.text} onChange={e => setSlide(i, { text: e.target.value })} /></label>
            <div className="row">
              {video && <label className="inline sec"><span>Seconds</span><input type="number" min={1} max={90} value={x.seconds} onChange={e => setSlide(i, { seconds: Number(e.target.value) })} /></label>}
              <button disabled={b || dirty || !x.visual.trim()} title={dirty ? 'Save your changes first' : ''} onClick={() => run(`gen${i}`, () => contentApi.generateSlide(item.id, i))}>{busy === `gen${i}` ? 'Drawing…' : x.file ? 'Redraw' : video ? 'Generate keyframe' : 'Generate picture'}</button>
              {media.slides.length > (media.format === 'image' ? 1 : 2) && <button className="linkish" onClick={() => setMedia({ ...media, slides: media.slides.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          </div>
        ))}
        {media.format !== 'image' && media.slides.length < 10 && <button className="slide add-slide" onClick={() => setMedia({ ...media, slides: [...media.slides, blank(video)] })}>+ {video ? 'Add a shot' : 'Add a slide'}</button>}
      </div>
      {video && <p className="hint small">Ripple_handoff writes the storyboard and the keyframes; the video itself is filmed or edited by you.</p>}

      <label>Hashtags<input value={tags} onChange={e => setTags(e.target.value)} placeholder="#mealprep #solodev" /></label>
      <div className="chips">{hashtags.map(h => <span key={h} className="pill">{h.startsWith('#') ? h : `#${h}`}</span>)}</div>

      <div className="row">
        {dirty && <button className="primary" disabled={b} onClick={() => run('savemedia', () => contentApi.patchItem(item.id, { media: edited }))}>Save media</button>}
        {!dirty && missing > 0 && <button disabled={b} onClick={() => run('genall', () => contentApi.generateMissing(item.id))}>{busy === 'genall' ? 'Drawing…' : `Generate ${missing} missing picture${missing > 1 ? 's' : ''}`}</button>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

// What it will look like in a feed: the first picture, how many there are, the description, the hashtags.
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
      <p className="pv-caption">{item.draft}</p>
      <p className="pv-tags">{m.hashtags.join(' ')}</p>
    </div>
  );
}
