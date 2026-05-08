class DeckStage extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this._index = 0
    this._scale = 1
    this._storageKey = ''
    this._onResize = () => this.render()
    this._onKey = e => this.handleKey(e)
  }

  connectedCallback() {
    this._storageKey = this.getAttribute('storage-key') || `deck-stage:${location.pathname}`
    this.renderShell()
    this.labelSlides()
    const saved = Number(localStorage.getItem(this._storageKey) || 0)
    this._index = Number.isFinite(saved) ? Math.max(0, Math.min(saved, this.slides.length - 1)) : 0
    window.addEventListener('resize', this._onResize)
    window.addEventListener('keydown', this._onKey)
    this.render()
    this.postIndex()
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._onResize)
    window.removeEventListener('keydown', this._onKey)
  }

  get slides() {
    return Array.from(this.querySelectorAll(':scope > section'))
  }

  labelSlides() {
    this.slides.forEach((slide, i) => {
      const n = String(i + 1).padStart(2, '0')
      if (!slide.hasAttribute('data-screen-label')) {
        const title = slide.getAttribute('data-title')
          || slide.querySelector('h1,h2,h3')?.textContent?.trim()
          || `Slide ${n}`
        slide.setAttribute('data-screen-label', `${n} ${title}`.trim())
      }
      slide.setAttribute('data-om-validate', 'slide')
    })
  }

  renderShell() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --deck-width: 1920;
          --deck-height: 1080;
          display: block;
          position: relative;
          width: 100vw;
          height: 100vh;
          background: #000;
          overflow: hidden;
          color: #fff;
        }
        .viewport {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          overflow: hidden;
        }
        .frame {
          width: calc(var(--deck-width) * 1px);
          height: calc(var(--deck-height) * 1px);
          transform-origin: center center;
          will-change: transform;
        }
        .chrome {
          position: absolute;
          inset: auto 20px 20px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          pointer-events: none;
          font: 500 13px/1.2 ui-sans-serif, system-ui, sans-serif;
          color: rgba(255,255,255,0.72);
          z-index: 10;
        }
        .controls {
          display: flex;
          gap: 8px;
          pointer-events: auto;
        }
        button {
          appearance: none;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.08);
          color: inherit;
          border-radius: 999px;
          padding: 8px 12px;
          cursor: pointer;
        }
        button:hover { background: rgba(255,255,255,0.14); }
        ::slotted(section) {
          width: calc(var(--deck-width) * 1px);
          height: calc(var(--deck-height) * 1px);
          display: none;
          box-sizing: border-box;
          overflow: hidden;
        }
        ::slotted(section.is-active) { display: block; }
        :host([noscale]) .frame { transform: none !important; }
        :host([presenting]) .chrome { opacity: 0; transition: opacity 160ms ease; }
        :host(:hover) .chrome { opacity: 1; }
        @media print {
          :host {
            background: transparent;
            width: auto;
            height: auto;
            overflow: visible;
          }
          .viewport, .frame {
            position: static;
            inset: auto;
            width: auto;
            height: auto;
            transform: none !important;
          }
          .chrome { display: none !important; }
          ::slotted(section) {
            display: block !important;
            break-after: page;
            page-break-after: always;
          }
        }
      </style>
      <div class="viewport">
        <div class="frame"><slot></slot></div>
      </div>
      <div class="chrome" part="chrome">
        <div class="counter" part="counter"></div>
        <div class="controls" part="controls">
          <button type="button" data-nav="-1" aria-label="Previous slide">Prev</button>
          <button type="button" data-nav="1" aria-label="Next slide">Next</button>
        </div>
      </div>
    `
    this.shadowRoot.querySelectorAll('button[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => this.go(this._index + Number(btn.dataset.nav || 0)))
    })
  }

  handleKey(e) {
    if (e.defaultPrevented) return
    const key = e.key
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(key)) {
      e.preventDefault()
      this.go(this._index + 1)
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(key)) {
      e.preventDefault()
      this.go(this._index - 1)
    } else if (key === 'Home') {
      e.preventDefault()
      this.go(0)
    } else if (key === 'End') {
      e.preventDefault()
      this.go(this.slides.length - 1)
    } else if (/^[1-9]$/.test(key)) {
      e.preventDefault()
      this.go(Math.min(Number(key) - 1, this.slides.length - 1))
    }
  }

  go(next) {
    const clamped = Math.max(0, Math.min(next, this.slides.length - 1))
    if (clamped === this._index && this.slides.some(s => s.classList.contains('is-active'))) return
    this._index = clamped
    localStorage.setItem(this._storageKey, String(clamped))
    this.render()
    this.postIndex()
  }

  postIndex() {
    window.postMessage({ slideIndexChanged: this._index }, '*')
  }

  render() {
    const width = Number(this.getAttribute('width') || 1920)
    const height = Number(this.getAttribute('height') || 1080)
    this.style.setProperty('--deck-width', String(width))
    this.style.setProperty('--deck-height', String(height))
    const frame = this.shadowRoot.querySelector('.frame')
    const viewport = this.shadowRoot.querySelector('.viewport')
    if (frame && viewport && !this.hasAttribute('noscale')) {
      const vw = viewport.clientWidth || window.innerWidth
      const vh = viewport.clientHeight || window.innerHeight
      this._scale = Math.min(vw / width, vh / height)
      frame.style.transform = `scale(${this._scale})`
    }
    this.slides.forEach((slide, i) => slide.classList.toggle('is-active', i === this._index))
    const counter = this.shadowRoot.querySelector('.counter')
    if (counter) counter.textContent = `${this._index + 1}/${this.slides.length || 1}`
  }
}

if (!customElements.get('deck-stage')) {
  customElements.define('deck-stage', DeckStage)
}
