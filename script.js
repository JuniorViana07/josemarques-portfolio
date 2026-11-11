// Portfólio de José Marques Viana Júnior
// Dois comportamentos: cabeçalho com linha ao rolar e a figura do fundo de olho
// com mapa de ativação (estilo Grad-CAM) que segue o cursor.

(() => {
  'use strict';

  const reduzMovimento = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Ano no rodapé
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  // Linha sob o cabeçalho depois de rolar a página
  const topo = document.getElementById('topo');
  const aoRolar = () => topo.classList.toggle('rolou', window.scrollY > 8);
  aoRolar();
  addEventListener('scroll', aoRolar, { passive: true });

  const canvas = document.getElementById('retina');
  if (canvas && canvas.getContext) iniciarRetina(canvas);

  function iniciarRetina(canvas) {
    const S = 224; // resolução interna (S x S pixels)
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');

    const suave = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const ruido = (x, y) => {
      const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    // coordenadas normalizadas (-1..1) para pixels
    const paraPx = (u) => ((u + 1) / 2) * S;

    // Pontos de interesse da imagem sintética
    const disco = { x: 0.36, y: -0.04 }; // disco óptico
    const macula = { x: -0.2, y: 0.02 };
    const pontosDeFoco = [
      { x: paraPx(disco.x), y: paraPx(disco.y) },
      { x: paraPx(macula.x), y: paraPx(macula.y) },
      { x: paraPx(0.02), y: paraPx(-0.46) },
      { x: paraPx(-0.04), y: paraPx(0.48) },
    ];

    // Imagem base (fundo de olho sintético) e máscara do círculo
    const base = new Uint8ClampedArray(S * S * 4);
    const mascara = new Float32Array(S * S);

    function gerarBase() {
      // vasos: curvas que saem do disco óptico
      const vasos = [];
      [2.15, 2.7, 3.14, 3.6, 4.1, 1.4, 4.8].forEach((ang, k) => {
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        for (let i = 0; i <= 48; i++) {
          const t = i / 48;
          const curva = Math.sin(t * 3.2 + k * 1.3) * 0.16 * t;
          vasos.push(disco.x + dx * t - dy * curva, disco.y + dy * t + dx * curva);
        }
      });

      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const u = ((x + 0.5) / S) * 2 - 1;
          const v = ((y + 0.5) / S) * 2 - 1;
          const r = Math.hypot(u, v);
          const dentro = 1 - suave(0.9, 0.97, r);

          // fundo: periferia escura, centro alaranjado
          const t = 1 - suave(0.15, 0.95, r);
          let R = 70 + (214 - 70) * t;
          let G = 18 + (100 - 18) * t;
          let B = 8 + (36 - 8) * t;

          // disco óptico (claro)
          const od = Math.exp(-Math.pow(Math.hypot(u - disco.x, v - disco.y) / 0.13, 2));
          R += (252 - R) * od * 0.9;
          G += (218 - G) * od * 0.9;
          B += (150 - B) * od * 0.9;

          // mácula (escura)
          const m = Math.exp(-Math.pow(Math.hypot(u - macula.x, v - macula.y) / 0.16, 2)) * 0.35;
          R *= 1 - m; G *= 1 - m; B *= 1 - m;

          // vasos (escuros)
          let menor = 9;
          for (let k = 0; k < vasos.length; k += 2) {
            const dx = u - vasos[k];
            const dy = v - vasos[k + 1];
            const d = dx * dx + dy * dy;
            if (d < menor) menor = d;
          }
          const vs = Math.exp(-menor / (2 * 0.018 * 0.018)) * 0.55;
          R += (110 - R) * vs; G += (16 - G) * vs; B += (10 - B) * vs;

          const n = 1 + (ruido(x, y) - 0.5) * 0.07;
          const i = (y * S + x) * 4;
          base[i] = R * n * dentro + 12 * (1 - dentro);
          base[i + 1] = G * n * dentro + 19 * (1 - dentro);
          base[i + 2] = B * n * dentro + 25 * (1 - dentro);
          base[i + 3] = 255;
          mascara[y * S + x] = dentro;
        }
      }
    }
    gerarBase();

    // Escala de cores do mapa de ativação (azul a vermelho), em tabela de consulta
    const lut = new Uint8Array(256 * 3);
    (() => {
      const paradas = [
        [0.0, [24, 48, 170]],
        [0.25, [16, 170, 225]],
        [0.5, [70, 210, 110]],
        [0.75, [250, 220, 40]],
        [1.0, [232, 44, 32]],
      ];
      for (let i = 0; i < 256; i++) {
        const h = i / 255;
        let k = 1;
        while (k < paradas.length - 1 && h > paradas[k][0]) k++;
        const [a, ca] = paradas[k - 1];
        const [b, cb] = paradas[k];
        const t = Math.min(1, Math.max(0, (h - a) / (b - a)));
        for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * t;
      }
    })();

    const quadro = ctx.createImageData(S, S);
    const sig = 30; // abertura do foco, em pixels

    function pintar(fx, fy, intensidade) {
      const out = quadro.data;
      out.set(base);

      // segundo lóbulo, deslocado, para um formato menos circular
      const f2x = fx + 0.55 * sig;
      const f2y = fy - 0.4 * sig;
      const sig2 = 0.7 * sig;
      const alcance = 3.2 * sig;
      const x0 = Math.max(0, Math.floor(fx - alcance));
      const x1 = Math.min(S - 1, Math.ceil(fx + alcance));
      const y0 = Math.max(0, Math.floor(fy - alcance));
      const y1 = Math.min(S - 1, Math.ceil(fy + alcance));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d1 = ((x - fx) ** 2 + (y - fy) ** 2) / (2 * sig * sig);
          const d2 = ((x - f2x) ** 2 + (y - f2y) ** 2) / (2 * sig2 * sig2);
          const h = Math.min(1, Math.exp(-d1) + 0.65 * Math.exp(-d2)) * intensidade;
          const a = suave(0.1, 0.55, h) * 0.8 * mascara[y * S + x];
          if (a <= 0.004) continue;
          const l = ((h * 255) | 0) * 3;
          const i = (y * S + x) * 4;
          out[i] += (lut[l] - out[i]) * a;
          out[i + 1] += (lut[l + 1] - out[i + 1]) * a;
          out[i + 2] += (lut[l + 2] - out[i + 2]) * a;
        }
      }
      ctx.putImageData(quadro, 0, 0);
    }

    // Movimento reduzido: um quadro estático, com o foco no disco óptico
    if (reduzMovimento) {
      pintar(pontosDeFoco[0].x, pontosDeFoco[0].y, 1);
      return;
    }

    // Animação: o foco surge no disco óptico (único momento de entrada),
    // percorre regiões da imagem e passa a seguir o cursor quando ele está sobre a figura.
    const inicio = performance.now();
    let foco = { x: pontosDeFoco[0].x, y: pontosDeFoco[0].y };
    let alvo = { ...foco };
    let indice = 0;
    let proximaTroca = inicio + 2600;
    let manualAte = 0;
    let ultimo = inicio;
    let visivel = true;
    let rodando = false;

    function passo(agora) {
      rodando = false;
      if (!visivel) return;

      const dt = Math.min(0.05, (agora - ultimo) / 1000);
      ultimo = agora;

      if (agora > manualAte && agora > proximaTroca) {
        indice = (indice + 1) % pontosDeFoco.length;
        alvo = pontosDeFoco[indice];
        proximaTroca = agora + 2800;
      }
      const k = Math.min(1, dt * 3.2);
      foco.x += (alvo.x - foco.x) * k;
      foco.y += (alvo.y - foco.y) * k;

      const t = Math.min(1, (agora - inicio) / 1800);
      const intensidade = 1 - Math.pow(1 - t, 3);

      pintar(foco.x, foco.y, intensidade);
      rodando = true;
      requestAnimationFrame(passo);
    }

    function retomar() {
      if (rodando || !visivel) return;
      ultimo = performance.now();
      rodando = true;
      requestAnimationFrame(passo);
    }

    function apontar(e) {
      const r = canvas.getBoundingClientRect();
      alvo = {
        x: ((e.clientX - r.left) / r.width) * S,
        y: ((e.clientY - r.top) / r.height) * S,
      };
    }

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      manualAte = Infinity;
      apontar(e);
    });
    canvas.addEventListener('pointerleave', () => {
      manualAte = performance.now() + 900;
      proximaTroca = manualAte;
    });
    canvas.addEventListener('pointerdown', (e) => {
      manualAte = performance.now() + 3500;
      proximaTroca = manualAte;
      apontar(e);
    });

    // Pausa quando a figura sai da tela
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((itens) => {
        visivel = itens[0].isIntersecting;
        if (visivel) retomar();
      }).observe(canvas);
    }

    retomar();
  }
})();
