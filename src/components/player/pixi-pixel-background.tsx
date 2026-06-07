import { useEffect, useMemo, useRef, useState } from "react";
import {
  type BackgroundEffectSettings,
  resolvePixiBackgroundEffectOptions,
} from "@/lib/background-effect-settings";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

export type PixiBackgroundEffect = "pixel" | "ascii" | "cross-hatch" | "crt" | "dot" | "noise";

export function PixiPixelBackground({
  className,
  effect = "pixel",
  effectSettings,
  pixelSize,
  src,
}: {
  className?: string;
  effect?: PixiBackgroundEffect;
  effectSettings: BackgroundEffectSettings;
  pixelSize: number;
  src: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const currentLayerRef = useRef<PixiLayer | null>(null);
  const [hasLayer, setHasLayer] = useState(false);
  const effectOptions = useMemo(
    () => resolvePixiBackgroundEffectOptions(effectSettings, pixelSize),
    [effectSettings, pixelSize],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let pendingLayer: PixiLayer | null = null;

    void (async () => {
      try {
        const Pixi = await import("pixi.js");
        if (disposed || !hostRef.current) return;

        const nextApp = new Pixi.Application();
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
        canvas.style.opacity = "0";
        canvas.style.transition = "opacity 300ms ease";

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
        const filter = await createPixiFilter(effect, effectOptions);
        if (disposed || !hostRef.current) {
          nextApp.destroy(
            { removeView: true },
            { children: true, context: true, texture: true, textureSource: true },
          );
          return;
        }
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
        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(hostRef.current);
        pendingLayer = { app: nextApp, canvas, resizeObserver };
        const previousLayer = currentLayerRef.current;
        currentLayerRef.current = pendingLayer;
        hostRef.current.appendChild(canvas);
        requestAnimationFrame(() => {
          if (disposed) return;
          canvas.style.opacity = "1";
        });
        window.setTimeout(() => {
          if (previousLayer && currentLayerRef.current !== previousLayer) {
            destroyPixiLayer(previousLayer);
          }
        }, 350);
        setHasLayer(true);
      } catch (err) {
        log.warn("background", "Pixi pixel background failed; falling back to image", err);
        if (!currentLayerRef.current) setHasLayer(false);
      }
    })();

    return () => {
      disposed = true;
      if (pendingLayer && currentLayerRef.current !== pendingLayer) {
        destroyPixiLayer(pendingLayer);
      }
    };
  }, [src, pixelSize, effect, effectOptions]);

  useEffect(
    () => () => {
      if (currentLayerRef.current) {
        destroyPixiLayer(currentLayerRef.current);
        currentLayerRef.current = null;
      }
    },
    [],
  );

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
          hasLayer ? "opacity-0" : "opacity-90",
        )}
      />
    </div>
  );
}

type PixiLayer = {
  app: import("pixi.js").Application;
  canvas: HTMLCanvasElement;
  resizeObserver: ResizeObserver;
};

function destroyPixiLayer(layer: PixiLayer) {
  layer.resizeObserver.disconnect();
  layer.app.destroy(
    { removeView: true },
    { children: true, context: true, texture: true, textureSource: true },
  );
}

async function createPixiFilter(
  effect: PixiBackgroundEffect,
  options: ReturnType<typeof resolvePixiBackgroundEffectOptions>,
): Promise<import("pixi.js").Filter | null> {
  switch (effect) {
    case "ascii": {
      const { AsciiFilter } = await import("pixi-filters/ascii");
      return new AsciiFilter(options.ascii);
    }
    case "cross-hatch": {
      const { CrossHatchFilter } = await import("pixi-filters/cross-hatch");
      return new CrossHatchFilter();
    }
    case "crt": {
      const { CRTFilter } = await import("pixi-filters/crt");
      return new CRTFilter(options.crt);
    }
    case "dot": {
      const { DotFilter } = await import("pixi-filters/dot");
      return new DotFilter(options.dot);
    }
    case "noise": {
      const { NoiseFilter } = await import("pixi.js");
      return new NoiseFilter(options.noise);
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
