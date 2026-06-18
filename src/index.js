import { WebGLRenderer } from './WebGLRenderer.js';

const loadMatter = () => {
  return new Promise((resolve) => {
    if (window.Matter) {
      resolve(window.Matter);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cloudflare.com';
    script.onload = () => resolve(window.Matter);
    document.head.appendChild(script);
  });
};

let Matter = null;

class Sprite {
  constructor(stage, options = {}) {
    this.stage = stage;
    this.w = options.w || 1;
    this.h = options.h || 1;
    this.color = options.color || [1.0, 1.0, 1.0, 1.0];
    
    this.costumes = Array.isArray(options.image) ? options.image : (options.image ? [options.image] : []);
    this.currentCostumeIndex = 0;
    this.texture = null;
    this.isLoaded = false;
    this.visible = true;
    this.isClone = false;

    this.physicsBody = Matter.Bodies.rectangle(options.x || 0, options.y || 0, this.w, this.h, {
      isStatic: options.isStatic || false,
      restitution: options.restitution || 0,
      friction: options.friction || 0.1
    });
    this.physicsBody.owner = this;
    
    Matter.Composite.add(this.stage.physicsEngine.world, this.physicsBody);
    this.scripts = [];
    this.updateCostumeTexture();
  }

  changeXBy(value) {
    Matter.Body.setPosition(this.physicsBody, { x: this.physicsBody.position.x + value, y: this.physicsBody.position.y });
  }
  changeYBy(value) {
    Matter.Body.setPosition(this.physicsBody, { x: this.physicsBody.position.x, y: this.physicsBody.position.y + value });
  }

  setXY(x, y) {
    Matter.Body.setPosition(this.physicsBody, { x: x, y: y });
  }

  pointInDirection(degrees) {
    const radians = (degrees - 90) * (Math.PI / 180);
    Matter.Body.setAngle(this.physicsBody, radians);
  }

  addVelocityY(force) {
    Matter.Body.setVelocity(this.physicsBody, { x: this.physicsBody.velocity.x, y: force });
  }

  nextCostume() {
    if (this.costumes.length <= 1) return;
    this.currentCostumeIndex = (this.currentCostumeIndex + 1) % this.costumes.length;
    this.updateCostumeTexture();
  }

  switchCostumeTo(indexOrUrl) {
    if (typeof indexOrUrl === 'number') {
      this.currentCostumeIndex = indexOrUrl % this.costumes.length;
    } else {
      const idx = this.costumes.indexOf(indexOrUrl);
      if (idx !== -1) this.currentCostumeIndex = idx;
      else { this.costumes.push(indexOrUrl); this.currentCostumeIndex = this.costumes.length - 1; }
    }
    this.updateCostumeTexture();
  }

  updateCostumeTexture() {
    if (this.costumes.length === 0) { this.isLoaded = true; return; }
    this.isLoaded = false;
    this.stage.renderer.loadTexture(this.costumes[this.currentCostumeIndex], (texture) => {
      this.texture = texture;
      this.isLoaded = true;
    });
  }

  show() { this.visible = true; }
  hide() { this.visible = false; }

  touching(otherSprite) {
    if (!otherSprite || !otherSprite.physicsBody) return false;
    return this.stage.activeCollisions.has(`${this.physicsBody.id}-${otherSprite.physicsBody.id}`) ||
           this.stage.activeCollisions.has(`${otherSprite.physicsBody.id}-${this.physicsBody.id}`);
  }

  forever(callback) {
    this.scripts.push(callback);
  }

  createClone() {
    const cloneOpts = {
      x: this.physicsBody.position.x,
      y: this.physicsBody.position.y,
      w: this.w,
      h: this.h,
      color: this.color,
      image: [...this.costumes],
      isStatic: this.physicsBody.isStatic,
      restitution: this.physicsBody.restitution,
      friction: this.physicsBody.friction
    };
    const clone = new Sprite(this.stage, cloneOpts);
    clone.isClone = true;
    clone.currentCostumeIndex = this.currentCostumeIndex;
    clone.texture = this.texture;
    clone.isLoaded = this.isLoaded;
    
    clone.scripts = [...this.scripts];
    this.stage.sprites.push(clone);
    return clone;
  }

  deleteThisClone() {
    if (!this.isClone) return;
    Matter.Composite.remove(this.stage.physicsEngine.world, this.physicsBody);
    this.stage.sprites = this.stage.sprites.filter(s => s !== this);
  }
}

export class Jsgame{
  constructor() {
    this.canvas = null;
    this.renderer = null;
    this.physicsEngine = null;
    this.sprites = [];
    this.keys = {};
    this.messageListeners = {};
    this.activeCollisions = new Set();
    this._initializedPromise = loadMatter().then((m) => {
      Matter = m;
      this.physicsEngine = Matter.Engine.create({ gravity: { x: 0, y: -9.8 } });
      this.setupCollisionDetection();
    });

    window.addEventListener('keydown', (e) => this.keys[e.key] = true);
    window.addEventListener('keyup', (e) => this.keys[e.key] = false);
  }

  keyPressed(keyName) { return !!this.keys[keyName]; }

  setupCollisionDetection() {
    Matter.Events.on(this.physicsEngine, 'collisionStart', (event) => {
      event.pairs.forEach(pair => {
        this.activeCollisions.add(`${pair.bodyA.id}-${pair.bodyB.id}`);
      });
    });
    Matter.Events.on(this.physicsEngine, 'collisionEnd', (event) => {
      event.pairs.forEach(pair => {
        this.activeCollisions.delete(`${pair.bodyA.id}-${pair.bodyB.id}`);
      });
    });
  }

  id(canvasElement) {
    this.canvas = canvasElement;
    this._initializedPromise.then(() => {
      this.renderer = new WebGLRenderer(this.canvas);
      this.resize();
    });
    return this;
  }

  background(url) {
    this.canvas.style.backgroundImage = `url('${url}')`;
    this.canvas.style.backgroundSize = 'cover';
    this.canvas.style.backgroundPosition = 'center';
    this.canvas.style.backgroundRepeat = 'no-repeat';
    return this;
  }

  newSprite(options) {
    const sprite = new Sprite(this, options);
    this.sprites.push(sprite);
    return sprite;
  }

  whenIReceive(message, callback) {
    if (!this.messageListeners[message]) this.messageListeners[message] = [];
    this.messageListeners[message].push(callback);
  }

  broadcast(message, data) {
    if (this.messageListeners[message]) {
      this.messageListeners[message].forEach(callback => callback(data));
    }
  }

  playSound(frequency = 440, duration = 0.1) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.start();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  }

  onstart() {
    this._initializedPromise.then(() => {
      window.addEventListener('resize', () => this.resize());
      this.lastTime = performance.now();

      const loop = (currentTime) => {
        requestAnimationFrame(loop);
        const dt = (currentTime - this.lastTime) / 1000;
        this.lastTime = currentTime;

        Matter.Engine.update(this.physicsEngine, dt * 1000);

        for (let i = this.sprites.length - 1; i >= 0; i--) {
          const sprite = this.sprites[i];
          if (sprite) {
            sprite.scripts.forEach(script => script(dt));
          }
        }

        if (this.renderer) {
          this.renderer.clear();
          this.renderer.render(this.sprites);
        }
      };
      requestAnimationFrame(loop);
    });
  }

  resize() {
    if (!this.canvas || !this.renderer) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.renderer.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }
}
