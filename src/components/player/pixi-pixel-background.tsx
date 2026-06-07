import { useEffect, useRef, useState } from "react";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

export type PixiBackgroundEffect = "pixel" | "ascii" | "cross-hatch" | "crt" | "dot" | "noise";

export function PixiPixelBackground({
  className,
  effect = "pixel",
  pixelSize,
  src,
}: {
  className?: string;
  effect?: PixiBackgroundEffect;
  pixelSize: number;
  src: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let app: import("pixi.js").Application | null = null;

    setReady(false);

    void (async () => {
      try {
        const Pixi = await import("pixi.js");
        if (disposed || !hostRef.current) return;

        const nextApp = new Pixi.Application();
        app = nextApp;
        await nextApp.init({
          antialias: false,
          autoDensity: false,
          backgroundAlpha: 0,
          height: 1,
          powerPreference: "low-power",
          preference: "webgl",
          resolution: 1,
          width: 1,
        });
        if (disposed || !hostRef.current) {
          nextApp.destroy({ removeView: true }, { children: true, context: true });
          return;
        }

        const canvas = nextApp.canvas;
        canvas.style.position = "absolute";
        canvas.style.inset = "0";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.imageRendering = effect === "pixel" ? "pixelated" : "auto";
        hostRef.current.appendChild(canvas);

        const image = await loadImage(src);
        if (disposed || !hostRef.current) {
          nextApp.destroy(
            { removeView: true },
            { children: true, context: true, texture: true, textureSource: true },
          );
          return;
        }

        const texture = Pixi.Texture.from(image, true);
        texture.source.scaleMode = "nearest";
        const sprite = new Pixi.Sprite(texture);
        const filter = await createPixiFilter(effect, pixelSize);
        if (filter) sprite.filters = [filter];
        nextApp.stage.addChild(sprite);

        const resize = () => {
          const container = hostRef.current;
          if (!container || disposed) return;
          const cssW = Math.max(1, Math.round(container.clientWidth));
          const cssH = Math.max(1, Math.round(container.clientHeight));
          const block = Math.max(3, Math.min(48, Math.round(pixelSize)));
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const renderW =
            effect === "pixel" ? Math.max(1, Math.round(cssW / block)) : Math.round(cssW * dpr);
          const renderH =
            effect === "pixel" ? Math.max(1, Math.round(cssH / block)) : Math.round(cssH * dpr);
          nextApp.renderer.resize(renderW, renderH);
          coverSprite(sprite, texture.width, texture.height, renderW, renderH);
          nextApp.render();
        };

        resize();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(hostRef.current);
        setReady(true);
      } catch (err) {
        log.warn("background", "Pixi pixel background failed; falling back to image", err);
        setReady(false);
      }
    })();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      app?.destroy(
        { removeView: true },
        { children: true, context: true, texture: true, textureSource: true },
      );
      app = null;
    };
  }, [src, pixelSize, effect]);

  return (
    <div
      ref={hostRef}
      className={cn("absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      <img
        src={src}
        alt=""
        decoding="async"
        className={cn(
          "absolute inset-0 h-full w-full object-cover transition-opacity duration-300",
          ready ? "opacity-0" : "opacity-90",
        )}
      />
    </div>
  );
}

async function createPixiFilter(
  effect: PixiBackgroundEffect,
  pixelSize: number,
): Promise<import("pixi.js").Filter | null> {
  const size = Math.max(4, Math.min(40, Math.round(pixelSize)));
  switch (effect) {
    case "ascii": {
      const { AsciiFilter } = await import("pixi-filters/ascii");
      return new AsciiFilter({ replaceColor: false, size });
    }
    case "cross-hatch": {
      const { CrossHatchFilter } = await import("pixi-filters/cross-hatch");
      return new CrossHatchFilter();
    }
    case "crt": {
      const { CRTFilter } = await import("pixi-filters/crt");
      return new CRTFilter({
        curvature: 0.35,
        lineContrast: 0.22,
        lineWidth: 1.25,
        noise: 0.12,
        noiseSize: 1,
        seed: 0.42,
        vignetting: 0.22,
        vignettingAlpha: 0.45,
        vignettingBlur: 0.25,
      });
    }
    case "dot": {
      const { DotFilter } = await import("pixi-filters/dot");
      return new DotFilter({ angle: 5, grayscale: false, scale: Math.max(0.6, size / 10) });
    }
    case "noise": {
      const { NoiseFilter } = await import("pixi.js");
      return new NoiseFilter({ noise: 0.28, seed: 0.37 });
    }
    default:
      return null;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load background image: ${src}`));
    image.src = src;
    if (image.decode) {
      void image.decode().then(
        () => resolve(image),
        () => {
          // Safari/WKWebView can reject decode() for images that still fire onload;
          // leave onload/onerror as the source of truth.
        },
      );
    }
  });
}

function coverSprite(
  sprite: import("pixi.js").Sprite,
  textureWidth: number,
  textureHeight: number,
  width: number,
  height: number,
) {
  const sourceW = Math.max(1, textureWidth);
  const sourceH = Math.max(1, textureHeight);
  const scale = Math.max(width / sourceW, height / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  sprite.scale.set(scale);
  sprite.position.set((width - drawW) / 2, (height - drawH) / 2);
}
