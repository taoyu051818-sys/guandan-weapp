const VS_LOGO = `
attribute vec4 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;
void main() {
    gl_Position = a_Position;  
    v_TexCoord = a_TexCoord;
}`;

const FS_LOGO = `
precision mediump float;
uniform sampler2D u_Sampler;
varying vec2 v_TexCoord;
void main() {
    gl_FragColor = texture2D(u_Sampler, v_TexCoord);
}`;

const VS_BG = `
attribute vec4 a_Position;
attribute vec2 a_TexCoord;
varying vec2 v_TexCoord;
void main() {
    gl_Position = a_Position;  
    v_TexCoord = a_TexCoord;
}`;

const FS_BG = `
precision mediump float;
uniform sampler2D u_Sampler;
uniform float u_flip;
varying vec2 v_TexCoord;
void main() {
    vec2 texCoord = v_TexCoord;
    if(u_flip > 0.5) {
        texCoord.y = 1.0 - texCoord.y;
    }
    gl_FragColor = texture2D(u_Sampler, texCoord);
}`;

const VS_PROGRESSBAR = `
precision mediump float;
attribute vec4 a_Position;
attribute float a_Progress;
varying float v_Progress;
void main() {
    gl_Position = a_Position;  
    v_Progress = a_Progress;
}`;

const FS_PROGRESSBAR = `
precision mediump float;
uniform float u_CurrentProgress;
varying float v_Progress;
uniform vec4 u_ProgressBarColor;
uniform vec4 u_ProgressBackground;
void main() {
    gl_FragColor = v_Progress <= u_CurrentProgress ? u_ProgressBarColor : u_ProgressBackground;
}`;

const options = {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
};

let gl = null;
let image = null;
let slogan = null;
let bg = null;
let program = null;
let programBg = null;
let programProgress = null;
let rafHandle = null;
let logoTexture = null;
let sloganTexture = null;
let bgTexture = null;
let vertexBuffer = null;
let sloganVertexBuffer = null;
let bgVertexBuffer = null;
let vertexBufferProgress = null;
let progress = 0.0;
let progressBarColor = [232 / 255, 181 / 255, 72 / 255, 1];
let progressBackground = [20 / 255, 25 / 255, 24 / 255, 0.72];
let afterTick = null;
let backgroundFilp = 1.0; // set 0 to not flip
let displayRatio = 1;
let bgColor = [0.01568627450980392,0.03529411764705882,0.0392156862745098,0.00392156862745098];
let useCustomBg = true;
let useLogo = false;
let useDefaultLogo = false;
let logoName = 'logo.png';
let bgName = 'background.jpg';
// Both false selects cover mode in Creator's first-screen implementation.
let fitWidth = false;
let fitHeight = false;
let ended = false;
let failureVisible = false;
let failureProgram = null;
let failureTexture = null;
let failureVertexBuffer = null;
let failureTouchHandler = null;
let failureMouseHandler = null;
let retryHandler = null;
let retryInProgress = false;

function initShaders(vshader, fshader) {
    return createProgram(vshader, fshader);
}

function createProgram(vshader, fshader) {
    var vertexShader = loadShader(gl.VERTEX_SHADER, vshader);
    var fragmentShader = loadShader(gl.FRAGMENT_SHADER, fshader);
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    var linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linked) {
        var error = gl.getProgramInfoLog(program);
        console.log('Failed to link program: ' + error);
        gl.deleteProgram(program);
        program = null;
    }
    gl.deleteShader(fragmentShader);
    gl.deleteShader(vertexShader);
    return program;
}

function loadShader(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    var compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
        var error = gl.getShaderInfoLog(shader);
        console.log('Failed to compile shader: ' + error);
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initVertexBuffer() {
    const widthRatio = 2 / canvas.width;
    const heightRatio = 2 / canvas.height;
    const heightOffset = 0.225;
    const vertices = new Float32Array([
        widthRatio,heightRatio + heightOffset, 1.0, 1.0,
        widthRatio, heightRatio + heightOffset, 1.0, 0.0,
        -widthRatio, heightRatio + heightOffset, 0.0, 1.0,
        -widthRatio, heightRatio + heightOffset, 0.0, 0.0,
    ]);
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function initSloganVertexBuffer() {
    const widthRatio = 2 / canvas.width;
    const heightRatio = 2 / canvas.height;
    const vertices = new Float32Array([
        widthRatio, heightRatio, 1.0, 1.0,
        widthRatio, heightRatio, 1.0, 0.0,
        -widthRatio, heightRatio, 0.0, 1.0,
        -widthRatio, heightRatio, 0.0, 0.0,
    ]);
    sloganVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sloganVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function initBgVertexBuffer() {
    const vertices = new Float32Array([
        1.0, 1.0, 1.0, 1.0,
        1.0, 0.0, 1.0, 0.0,
        0.0, 1.0, 0.0, 1.0,
        0.0, 0.0, 0.0, 0.0,
    ]);
    bgVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bgVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function initProgressVertexBuffer() {
    // the ratio value may be adjusted according to the image pixels
    const widthRatio = 0.5;
    const heightRatio = (window.devicePixelRatio >= 2 ? 6 : 3) / canvas.height * 1.35;
    const heightOffset = -0.8;
    const vertices = new Float32Array([
        widthRatio, heightOffset - heightRatio, 1,
        widthRatio, heightOffset + heightRatio, 1,
        -widthRatio, heightOffset - heightRatio, 0,
        -widthRatio, heightOffset + heightRatio, 0,
    ]);
    vertexBufferProgress = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBufferProgress);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function updateVertexBuffer() {
    const heightRatio = 1.0 * 0.185 * displayRatio;
    const widthRatio = image.width * (canvas.height * 0.185 / image.height) / canvas.width * displayRatio;
    
    const vertices = new Float32Array([
        widthRatio, -heightRatio, 1.0, 1.0,
        widthRatio, heightRatio, 1.0, 0.0,
        -widthRatio, -heightRatio, 0.0, 1.0,
        -widthRatio, heightRatio, 0.0, 0.0,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function updateSloganVertexBuffer() {
    // the ratio value may be adjusted according to the image pixels
    const widthRatio = slogan.width / canvas.width * 0.75;
    const heightRatio = slogan.height / canvas.height * 0.75;
    const logoHeightRatio = image.height / canvas.height * 1.35 * displayRatio;
    const heightOffset = (5/12 + logoHeightRatio * 1/2 + heightRatio * 3/2)  * (-2) + 1; // 5/12 is ui design layout for logo
    const vertices = new Float32Array([
        widthRatio, heightOffset - heightRatio, 1.0, 1.0,
        widthRatio, heightOffset + heightRatio, 1.0, 0.0,
        -widthRatio, heightOffset - heightRatio, 0.0, 1.0,
        -widthRatio, heightOffset + heightRatio, 0.0, 0.0,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, sloganVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function updateBgVertexBuffer() {
    let widthRatio = 1;
    let heightRatio = 1;
    if(fitWidth && !fitHeight) {
        widthRatio = canvas.width;
        heightRatio = (canvas.width / bg.width) * bg.height;
    } else if(!fitWidth && fitHeight) {
        widthRatio = (canvas.height / bg.height) * bg.width;
        heightRatio = canvas.height;
    } else if(fitWidth && fitHeight) {
        if ((bg.width / bg.height) > (canvas.width / canvas.height)) {
            widthRatio = canvas.width;
            heightRatio = (canvas.width / bg.width) * bg.height;
        } else {
            widthRatio = (canvas.height / bg.height) * bg.width;
            heightRatio = canvas.height;
        }
    } else if(!fitWidth && !fitHeight) {
        if ((bg.width / bg.height) > (canvas.width / canvas.height)) {
            widthRatio = (canvas.height / bg.height) * bg.width;
            heightRatio = canvas.height;
        } else {
            widthRatio = canvas.width;
            heightRatio = (canvas.width / bg.width) * bg.height;
        }
    } else {
        widthRatio = canvas.width;
        heightRatio = canvas.height;
    }
    widthRatio /= canvas.width;
    heightRatio /= canvas.height;

    const vertices = new Float32Array([
        widthRatio, heightRatio, 1.0, 1.0,
        widthRatio, -heightRatio, 1.0, 0.0,
        -widthRatio, heightRatio, 0.0, 1.0,
        -widthRatio, -heightRatio, 0.0, 0.0,
    ]);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
}

function loadBackground(bgPath) {
    return new Promise((resolve, reject) => {
        bg = new Image();
        bg.premultiplyAlpha = false;
        bg.onload = function() {
            resolve(bg);
        };
        bg.onerror = function(err) {
            reject(err);
        };
        bg.src = bgPath.replace('#', '%23');
    });
}

function loadImage(imgPath) {
    return new Promise((resolve, reject) => {
        image = new Image();
        image.premultiplyAlpha = false;
        image.onload = function() {
            resolve(image);
        };
        image.onerror = function(err) {
            reject(err);
        };
        image.src = imgPath.replace('#', '%23');
    });
}

function loadSlogan(sloganPath) {
    return new Promise((resolve, reject) => {
        slogan = new Image();
        slogan.premultiplyAlpha = false;
        slogan.onload = function() {
            resolve(slogan);
        };
        slogan.onerror = function(err) {
            reject(err);
        };
        slogan.src = sloganPath.replace('#', '%23');
    });
}


function initLogoTexture() {
    logoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, logoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]));
}

function initSloganTexture() {
    sloganTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sloganTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]));
}

function initBgTexture() {
    bgTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]));
}

function updateLogoTexture() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, logoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
}

function updateSloganTexture() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sloganTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, slogan);
}

function updateBgTexture() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bg);
}

function drawTexture(gl, program, texture, vertexBuffer, vertexFormatLength) {
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    var uSampler = gl.getUniformLocation(program, 'u_Sampler');
    gl.uniform1i(uSampler, 0);
    var uFlip = gl.getUniformLocation(program, 'u_flip');
    gl.uniform1f(uFlip, backgroundFilp);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    var aPosition = gl.getAttribLocation(program, 'a_Position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, vertexFormatLength * 4, 0);
    var aTexCoord = gl.getAttribLocation(program, 'a_TexCoord');
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, vertexFormatLength * 4, vertexFormatLength * 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function drawProgressBar(gl, program, vertexBuffer, vertexFormatLength, progress, progressBarColor, progressBackground) {
    gl.useProgram(program);
    var uCurrentProgress = gl.getUniformLocation(program, 'u_CurrentProgress');
    gl.uniform1f(uCurrentProgress, progress);
    var uProgressBarColor = gl.getUniformLocation(program, 'u_ProgressBarColor');
    gl.uniform4fv(uProgressBarColor, progressBarColor);
    var uProgressBackground = gl.getUniformLocation(program, 'u_ProgressBackground');
    gl.uniform4fv(uProgressBackground, progressBackground);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    var aPosition = gl.getAttribLocation(program, 'a_Position');
    gl.enableVertexAttribArray(aPosition);
    var vertexFormatLength = 4;
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, vertexFormatLength * 3, 0);
    var aProgress = gl.getAttribLocation(program, 'a_Progress');
    gl.enableVertexAttribArray(aProgress);
    gl.vertexAttribPointer(aProgress, 1, gl.FLOAT, false, vertexFormatLength * 3, vertexFormatLength * 2);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function draw() {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(bgColor[0], bgColor[1], bgColor[2], bgColor[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // draw background
    useCustomBg && drawTexture(gl, programBg, bgTexture, bgVertexBuffer, 4);
    // draw logo
    useLogo && drawTexture(gl, program, logoTexture, vertexBuffer, 4);
    // draw slogan
    useLogo && useDefaultLogo && drawTexture(gl, program, sloganTexture, sloganVertexBuffer, 4);
    // draw progress bar
    drawProgressBar(gl, programProgress, vertexBufferProgress, 3, progress, progressBarColor, progressBackground);
}

function tick() {
    rafHandle = requestAnimationFrame(() => {
        draw();
        tick();
        if (afterTick) {
            afterTick();
            afterTick = null;
        }
    });
}

function stopTick() {
    if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
    }
}

function removeFailureListeners() {
    if (failureTouchHandler && typeof wx !== 'undefined' && wx.offTouchEnd) {
        wx.offTouchEnd(failureTouchHandler);
    }
    if (failureMouseHandler && canvas && canvas.removeEventListener) {
        canvas.removeEventListener('mouseup', failureMouseHandler);
    }
    failureTouchHandler = null;
    failureMouseHandler = null;
}

function deleteFailureResources() {
    if (!gl) {
        return;
    }
    failureTexture && gl.deleteTexture(failureTexture);
    failureVertexBuffer && gl.deleteBuffer(failureVertexBuffer);
    failureProgram && gl.deleteProgram(failureProgram);
    failureTexture = null;
    failureVertexBuffer = null;
    failureProgram = null;
}

function deleteFirstScreenResources() {
    if (!gl) {
        return;
    }
    gl.useProgram(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    logoTexture && gl.deleteTexture(logoTexture);
    sloganTexture && gl.deleteTexture(sloganTexture);
    bgTexture && gl.deleteTexture(bgTexture);
    vertexBuffer && gl.deleteBuffer(vertexBuffer);
    bgVertexBuffer && gl.deleteBuffer(bgVertexBuffer);
    sloganVertexBuffer && gl.deleteBuffer(sloganVertexBuffer);
    vertexBufferProgress && gl.deleteBuffer(vertexBufferProgress);
    program && gl.deleteProgram(program);
    programBg && gl.deleteProgram(programBg);
    programProgress && gl.deleteProgram(programProgress);
    logoTexture = null;
    sloganTexture = null;
    bgTexture = null;
    vertexBuffer = null;
    bgVertexBuffer = null;
    sloganVertexBuffer = null;
    vertexBufferProgress = null;
    program = null;
    programBg = null;
    programProgress = null;
}

function end() {
    if (ended) {
        return Promise.resolve();
    }
    const finish = () => {
        stopTick();
        removeFailureListeners();
        deleteFailureResources();
        deleteFirstScreenResources();
        failureVisible = false;
        ended = true;
    };
    // A failure screen has already replaced the progress animation, so there
    // is no next tick available to resolve setProgress(). Its last frame is
    // intentionally kept in the framebuffer until Cocos starts rendering.
    if (failureVisible || rafHandle === null) {
        finish();
        return Promise.resolve();
    }
    return setProgress(1).then(finish);
}

function setProgress(val) {
    progress = val;
    if (failureVisible || ended || rafHandle === null) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        afterTick = () => {
            resolve();
        };
    });
}

function createFailureCanvas(width, height) {
    if (typeof wx !== 'undefined' && wx.createOffscreenCanvas) {
        try {
            return wx.createOffscreenCanvas({ type: '2d', width, height });
        } catch (err) {
            console.warn('[first-screen] Object-form offscreen canvas is unavailable.', err);
            try {
                const offscreen = wx.createOffscreenCanvas();
                offscreen.width = width;
                offscreen.height = height;
                return offscreen;
            } catch (fallbackErr) {
                console.warn('[first-screen] Offscreen canvas is unavailable.', fallbackErr);
            }
        }
    }
    if (typeof document !== 'undefined' && document.createElement) {
        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        return offscreen;
    }
    return null;
}

function drawFailure(message, retrying) {
    if (!gl) {
        return false;
    }
    stopTick();
    deleteFailureResources();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(28 / 255, 13 / 255, 14 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const scale = Math.min(1, 960 / Math.max(1, canvas.width));
    const width = Math.max(320, Math.round(canvas.width * scale));
    const height = Math.max(180, Math.round(canvas.height * scale));
    const failureCanvas = createFailureCanvas(width, height);
    const ctx = failureCanvas && failureCanvas.getContext && failureCanvas.getContext('2d');
    if (!ctx) {
        return false;
    }

    ctx.fillStyle = '#1c0d0e';
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f4eee7';
    ctx.font = 'bold ' + Math.max(28, Math.round(height * 0.09)) + 'px sans-serif';
    ctx.fillText(retrying ? '\u6b63\u5728\u91cd\u8bd5' : '\u6e38\u620f\u542f\u52a8\u5931\u8d25', width / 2, height * 0.34);
    ctx.fillStyle = '#d6c5bb';
    ctx.font = Math.max(18, Math.round(height * 0.042)) + 'px sans-serif';
    ctx.fillText(message || '\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5', width / 2, height * 0.48);

    const buttonWidth = Math.min(width * 0.46, 360);
    const buttonHeight = Math.max(48, height * 0.12);
    const buttonX = (width - buttonWidth) / 2;
    const buttonY = height * 0.62;
    ctx.fillStyle = retrying ? '#665850' : '#d89a37';
    ctx.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);
    ctx.fillStyle = '#fffaf3';
    ctx.font = 'bold ' + Math.max(18, Math.round(height * 0.046)) + 'px sans-serif';
    ctx.fillText(retrying ? '\u8bf7\u7a0d\u5019' : '\u70b9\u51fb\u5c4f\u5e55\u91cd\u8bd5', width / 2, buttonY + buttonHeight / 2);

    failureProgram = initShaders(VS_BG, FS_BG);
    failureVertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, failureVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        1, 1, 1, 1,
        1, -1, 1, 0,
        -1, 1, 0, 1,
        -1, -1, 0, 0,
    ]), gl.STATIC_DRAW);
    failureTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, failureTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, failureCanvas);
    drawTexture(gl, failureProgram, failureTexture, failureVertexBuffer, 4);
    return true;
}

function runRetry() {
    if (retryInProgress || !retryHandler) {
        return;
    }
    retryInProgress = true;
    const action = retryHandler;
    removeFailureListeners();
    drawFailure('\u6b63\u5728\u91cd\u65b0\u8fde\u63a5\u6e38\u620f', true);
    Promise.resolve().then(action).catch((err) => {
        console.error('[first-screen] Retry failed.', err);
        return showFailure('\u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u518d\u8bd5\u4e00\u6b21', action);
    }).then(() => {
        retryInProgress = false;
    }, (err) => {
        retryInProgress = false;
        throw err;
    });
}

function bindFailureRetry() {
    removeFailureListeners();
    failureTouchHandler = runRetry;
    failureMouseHandler = runRetry;
    if (typeof wx !== 'undefined' && wx.onTouchEnd) {
        wx.onTouchEnd(failureTouchHandler);
    }
    if (canvas && canvas.addEventListener) {
        canvas.addEventListener('mouseup', failureMouseHandler);
    }
}

function showFailure(message, onRetry) {
    failureVisible = true;
    retryHandler = typeof onRetry === 'function' ? onRetry : null;
    let rendered = false;
    try {
        rendered = drawFailure(message, false);
    } catch (err) {
        console.error('[first-screen] Failed to draw the startup error screen.', err);
    }
    if (retryHandler) {
        bindFailureRetry();
    }
    if (!rendered && typeof wx !== 'undefined' && wx.showModal) {
        wx.showModal({
            title: '\u6e38\u620f\u542f\u52a8\u5931\u8d25',
            content: message || '\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5',
            confirmText: '\u91cd\u8bd5',
            showCancel: false,
            success(result) {
                result.confirm && runRetry();
            },
        });
    }
    return Promise.resolve();
}

function clearFailure() {
    removeFailureListeners();
    deleteFailureResources();
    failureVisible = false;
    retryHandler = null;
}

function start(alpha, antialias, useWebgl2) {
    ended = false;
    failureVisible = false;
    retryHandler = null;
    retryInProgress = false;
    removeFailureListeners();
    options.alpha = alpha === 'true' ? true : false;
    options.antialias = antialias === 'false' ? false : true;
    if (useWebgl2 === 'true') {
        gl = window.canvas.getContext("webgl2", options);
    }
    // TODO: this is a hack method to detect whether WebGL2RenderingContext is supported
    if (gl) {
        window.WebGL2RenderingContext = true;
    } else {
        window.WebGL2RenderingContext = false;
        gl = window.canvas.getContext("webgl", options);
    }
    if (!gl) {
        return Promise.reject(new Error('WebGL is unavailable.'));
    }
    initVertexBuffer();
    useCustomBg && initBgVertexBuffer();
    useLogo && useDefaultLogo && initSloganVertexBuffer();
    initProgressVertexBuffer();

    initLogoTexture();
    useCustomBg && initBgTexture();
    useLogo && useDefaultLogo && initSloganTexture();

    if (useLogo) {
        program = initShaders(VS_LOGO, FS_LOGO);
    }
    if (useCustomBg) {
        programBg = initShaders(VS_BG, FS_BG);
    }
    programProgress = initShaders(VS_PROGRESSBAR, FS_PROGRESSBAR);
    tick();
    
    return Promise.all([
        //logo should be loaded earlier than slogan
        useLogo && loadImage(logoName).then(() => {
            updateVertexBuffer();
            updateLogoTexture();
        }).then(() => {
            return useLogo && useDefaultLogo && loadSlogan('slogan.png').then(() => {
                updateSloganVertexBuffer();
                updateSloganTexture();
            });
        }),
        useCustomBg && loadBackground(bgName).then(() => {
            updateBgVertexBuffer();
            updateBgTexture();
        }).catch((err) => {
            // The loading picture is optional. A broken or missing custom
            // image must not prevent the engine package from starting.
            console.warn('[first-screen] Custom background failed to load; using a solid color.', err);
            useCustomBg = false;
            bgColor = [4 / 255, 9 / 255, 10 / 255, 1];
        })
    ]).then(() => {
        return setProgress(0);
    });
}
module.exports = { start, end, setProgress, showFailure, clearFailure };
