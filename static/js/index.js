document.querySelectorAll('a[href^="#"]:not([href="#"])').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

// Native controls need the same seekable source on non-range local servers.
document.querySelectorAll('.main-demo').forEach(async (video) => {
  if (location.protocol === 'file:') return;
  try {
    const source = video.getAttribute('src') || video.querySelector('source').getAttribute('src');
    const response = await fetch(source, { cache: 'no-store', headers: { Range: 'bytes=0-0' } });
    if (response.status === 206) {
      await response.body?.cancel();
      return;
    }
    if (!response.ok) throw new Error(`Video request failed: ${response.status}`);
    const blob = await response.blob();
    const time = video.currentTime;
    const resume = !video.paused;
    video.autoplay = false;
    video.src = URL.createObjectURL(blob);
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = time;
      if (resume) video.play().catch(() => {});
    }, { once: true });
    video.load();
  } catch (error) {
    console.error('Could not prepare main demo for seeking', error);
  }
});

document.querySelectorAll('.comparison-wipe').forEach((wipe) => {
  const range = wipe.querySelector('.wipe-range');
  const videos = [...wipe.querySelectorAll('video')];
  const button = wipe.parentElement.querySelector('.comparison-play');
  let active = false;
  let restarting = false;
  let wantsPlay = true;
  let generation = 0;
  let scrubbing = false;
  let seekVersion = 0;
  const timeline = document.createElement('input');
  timeline.type = 'range';
  timeline.className = 'comparison-timeline';
  timeline.min = 0;
  timeline.max = 0;
  timeline.step = 0.01;
  timeline.value = 0;
  timeline.setAttribute('aria-label', 'Seek both comparison videos');
  button.after(timeline);
  // Fall back to a seekable Blob when a host ignores byte-range requests.
  const mediaReady = new Map();
  const prepareMedia = (video) => {
    if (!mediaReady.has(video)) mediaReady.set(video, (async () => {
      if (location.protocol === 'file:') return;
      const response = await fetch(video.getAttribute('src'), { cache: 'no-store', headers: { Range: 'bytes=0-0' } });
      if (response.status === 206) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok) throw new Error(`Video request failed: ${response.status}`);
      video.src = URL.createObjectURL(await response.blob());
      video.load();
    })());
    return mediaReady.get(video);
  };
  const pausePair = () => { generation++; videos.forEach((video) => video.pause()); };
  const ready = async (video) => {
    await prepareMedia(video);
    if (video.readyState >= 2) return;
    await new Promise((resolve, reject) => {
      video.addEventListener('canplay', resolve, { once: true });
      video.addEventListener('error', reject, { once: true });
    });
  };
  const seek = (video, time) => new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001 && !video.seeking) return resolve();
    video.addEventListener('seeked', resolve, { once: true });
    video.currentTime = time;
  });
  const playPair = async () => {
    const token = ++generation;
    try {
      await Promise.all(videos.map(ready));
    } catch (error) {
      button.textContent = 'Video unavailable — reload to retry';
      console.error(error);
      return;
    }
    if (token !== generation || !active || !wantsPlay || scrubbing) return;
    videos.forEach((video) => { video.muted = true; });
    await seek(videos[1], videos[0].currentTime);
    if (token !== generation || !active || !wantsPlay || scrubbing) return;
    const results = await Promise.allSettled(videos.map((video) => video.play()));
    if (token !== generation) return;
    if (!active || !wantsPlay || results.some((result) => result.status === 'rejected')) {
      videos.forEach((video) => video.pause());
    }
  };
  const updateDuration = () => {
    const duration = Math.min(...videos.map((item) => item.duration));
    if (Number.isFinite(duration)) timeline.max = duration;
  };
  videos.forEach((video) => video.addEventListener('loadedmetadata', updateDuration));
  updateDuration();
  const beginScrub = () => {
    scrubbing = true;
    pausePair();
  };
  timeline.addEventListener('pointerdown', beginScrub);
  timeline.addEventListener('input', () => {
    if (!scrubbing) beginScrub();
    const targetTime = Number(timeline.value);
    // Preview without restarting playback during a drag.
    videos.forEach((video) => { video.currentTime = targetTime; });
  });
  const finishScrub = async () => {
    if (!scrubbing) return;
    const version = ++seekVersion;
    const targetTime = Number(timeline.value);
    await Promise.all(videos.map((video) => seek(video, targetTime)));
    if (version !== seekVersion) return;
    scrubbing = false;
    if (active && wantsPlay) playPair();
  };
  timeline.addEventListener('change', finishScrub);
  timeline.addEventListener('pointerup', finishScrub);
  timeline.addEventListener('pointercancel', finishScrub);
  timeline.addEventListener('blur', finishScrub);
  wipe.addEventListener('comparison-active', (event) => {
    active = event.detail;
    if (active && wantsPlay) playPair();
    else pausePair();
  });
  const setSplit = (value) => {
    range.value = value;
    wipe.style.setProperty('--split', `${range.value}%`);
  };
  range.addEventListener('input', () => setSplit(range.value));
  const drag = (event) => {
    const rect = wipe.getBoundingClientRect();
    setSplit(Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)));
  };
  range.addEventListener('pointerdown', (event) => {
    range.setPointerCapture(event.pointerId);
    drag(event);
  });
  range.addEventListener('pointermove', (event) => {
    if (range.hasPointerCapture(event.pointerId)) drag(event);
  });
  button.addEventListener('click', async () => {
    wantsPlay = !wantsPlay;
    if (!wantsPlay) {
      pausePair();
    } else {
      await playPair();
    }
  });
  videos[0].addEventListener('play', () => { button.textContent = 'Pause comparison'; });
  videos[0].addEventListener('pause', () => { button.textContent = 'Play comparison'; });
  videos[0].addEventListener('timeupdate', () => {
    if (!scrubbing && !videos[0].seeking) timeline.value = videos[0].currentTime;
    if (!scrubbing && !videos[0].paused && !videos[1].seeking && Math.abs(videos[1].currentTime - videos[0].currentTime) > 0.08) videos[1].currentTime = videos[0].currentTime;
  });
  videos[0].addEventListener('ended', async () => {
    if (restarting || scrubbing || !active || !wantsPlay) return;
    restarting = true;
    pausePair();
    const token = generation;
    await Promise.all(videos.map((video) => seek(video, 0)));
    if (token === generation && active && wantsPlay) await playPair();
    restarting = false;
  });
});

document.querySelectorAll('.video-slider').forEach((slider) => {
  const track = slider.querySelector('.video-track');
  const slides = [...track.children];
  const dots = [...slider.querySelectorAll('.video-dots button')];
  const previous = slider.querySelector('.video-prev');
  const next = slider.querySelector('.video-next');
  let current = 0;
  let activeSlide = -1;
  const update = () => {
    current = Math.round(track.scrollLeft / track.clientWidth);
    dots.forEach((dot, index) => {
      if (index === current) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
    previous.disabled = current === 0;
    next.disabled = current === slides.length - 1;
    slider.querySelector('.video-counter').textContent = `${current + 1} / ${slides.length}`;
    if (activeSlide !== current) {
      activeSlide = current;
      slides.forEach((slide, index) => {
        slide.querySelector('.comparison-wipe').dispatchEvent(new CustomEvent('comparison-active', { detail: index === current }));
      });
    }
  };
  const go = (index) => track.scrollTo({
    left: Math.max(0, Math.min(slides.length - 1, index)) * track.clientWidth,
    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  });
  previous.addEventListener('click', () => go(current - 1));
  next.addEventListener('click', () => go(current + 1));
  dots.forEach((dot, index) => dot.addEventListener('click', () => go(index)));
  track.addEventListener('scroll', update, { passive: true });
  track.addEventListener('keydown', (event) => {
    if (event.target !== track) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      go(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  update();
});

document.querySelectorAll('[data-copy-target]').forEach((button) => {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    await navigator.clipboard.writeText(target.textContent);
    const oldLabel = button.innerHTML;
    button.innerHTML = '<i class="fas fa-check"></i> Copied';
    window.setTimeout(() => { button.innerHTML = oldLabel; }, 1600);
  });
});
