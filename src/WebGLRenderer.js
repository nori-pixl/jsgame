export class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2');
    if (!this.gl) {
      throw new Error('WebGL2 not supported');
    }
    // テクスチャキャッシュ（同一URLの重複ロードを防ぐ）
    this.textureCache = new Map();
    this.initGL();
    this.initShaders();
    this.initBuffers();
  }

  initGL() {
    const gl = this.gl;
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // 深度テストは使用しないため有効化しない
  }

  initShaders() {
    const gl = this.gl;

    // 修正: uResolution を実際に使用し、ハードコードされた座標範囲を除去
    const vsSource = `#version 300 es
      in vec2 aPosition;
      in vec2 aTexCoord;
      uniform vec2 uResolution;
      uniform vec2 uTranslation;
      uniform vec2 uScale;
      uniform float uRotation;
      out vec2 vTexCoord;
      void main() {
        float cosR = cos(uRotation);
        float sinR = sin(uRotation);
        vec2 rotatedPosition = vec2(
          aPosition.x * cosR - aPosition.y * sinR,
          aPosition.x * sinR + aPosition.y * cosR
        );
        vec2 scaledPosition = rotatedPosition * uScale;
        vec2 worldPosition = scaledPosition + uTranslation;

        // ピクセル座標 → クリップ空間 (-1〜+1) への変換
        // 原点はキャンバス中央
        vec2 clipSpace = (worldPosition / (uResolution * 0.5));
        clipSpace.y = -clipSpace.y; // Y軸を反転（下向きを正にする）
        gl_Position = vec4(clipSpace, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }`;

    const fsSource = `#version 300 es
      precision highp float;
      in vec2 vTexCoord;
      uniform vec4 uColor;
      uniform sampler2D uTexture;
      uniform bool uUseTexture;
      out vec4 fragColor;
      void main() {
        if (uUseTexture) {
          fragColor = texture(uTexture, vTexCoord);
        } else {
          fragColor = uColor;
        }
      }`;

    const vertexShader = this._compileShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this._compileShader(gl.FRAGMENT_SHADER, fsSource);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    // 修正: リンクエラーチェックを追加
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(this.program);
      gl.deleteProgram(this.program);
      throw new Error(`Shader program link failed: ${log}`);
    }

    // シェーダーはリンク後に不要なので削除
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    this.positionLocation   = gl.getAttribLocation(this.program, 'aPosition');
    this.texCoordLocation   = gl.getAttribLocation(this.program, 'aTexCoord');
    this.resolutionLocation = gl.getUniformLocation(this.program, 'uResolution');
    this.translationLocation = gl.getUniformLocation(this.program, 'uTranslation');
    this.scaleLocation      = gl.getUniformLocation(this.program, 'uScale');
    this.rotationLocation   = gl.getUniformLocation(this.program, 'uRotation');
    this.colorLocation      = gl.getUniformLocation(this.program, 'uColor');
    this.textureLocation    = gl.getUniformLocation(this.program, 'uTexture');
    this.useTextureLocation = gl.getUniformLocation(this.program, 'uUseTexture');
  }

  // 修正: シェーダーコンパイルを共通化し、エラーチェックを追加
  _compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      const typeName = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
      throw new Error(`${typeName} shader compile failed: ${log}`);
    }
    return shader;
  }

  initBuffers() {
    const gl = this.gl;

    // 修正: VAOを使用してバインド操作をまとめる
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const positions = [
      -0.5, -0.5,
       0.5, -0.5,
      -0.5,  0.5,
      -0.5,  0.5,
       0.5, -0.5,
       0.5,  0.5,
    ];
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    const texCoords = [
      0.0, 1.0,
      1.0, 1.0,
      0.0, 0.0,
      0.0, 0.0,
      1.0, 1.0,
      1.0, 0.0,
    ];
    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  loadTexture(url, callback) {
    const gl = this.gl;

    // 修正: キャッシュに存在する場合は即返す
    if (this.textureCache.has(url)) {
      callback(this.textureCache.get(url));
      return;
    }

    const texture = gl.createTexture();
    const image = new Image();

    // crossOrigin は CORSヘッダーを持つサーバーからの画像に有効
    // ローカルファイルや CORSヘッダーのないサーバーでは失敗する点に注意
    image.crossOrigin = 'anonymous';

    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textureCache.set(url, texture);
      callback(texture);
    };

    image.onerror = () => {
      console.error(`WebGLRenderer: テクスチャの読み込みに失敗しました: ${url}`);
      gl.deleteTexture(texture);
    };

    image.src = url;
  }

  clear() {
    const gl = this.gl;
    // 修正: DEPTH_BUFFER_BIT は深度テストを使わないため不要
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  render(sprites) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);

    // 修正: VAOを一度バインドするだけでよい
    gl.bindVertexArray(this.vao);

    sprites.forEach(sprite => {
      if (!sprite.visible || !sprite.isLoaded) return;

      gl.uniform2f(this.translationLocation, sprite.physicsBody.position.x, sprite.physicsBody.position.y);
      gl.uniform2f(this.scaleLocation, sprite.w, sprite.h);
      gl.uniform1f(this.rotationLocation, sprite.physicsBody.angle);

      if (sprite.texture) {
        gl.uniform1i(this.useTextureLocation, 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
        gl.uniform1i(this.textureLocation, 0);
      } else {
        gl.uniform1i(this.useTextureLocation, 0);
        gl.uniform4fv(this.colorLocation, sprite.color);
      }

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    });

    gl.bindVertexArray(null);
  }
      }
