// Apply look-and-feel settings before anything paints (no flash). Loaded as a plain script in <head>.
try{ const s = JSON.parse(localStorage.getItem('jig.settings') || '{}'), d = document.documentElement;
  if(s.textScale) d.style.setProperty('--ui-zoom', s.textScale);
  if(s.contrast === 'high') d.dataset.contrast = 'high';
  if(s.table === 'light') d.dataset.table = 'light';
  if(s.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches) d.dataset.motion = 'reduce'; }catch(_){}
