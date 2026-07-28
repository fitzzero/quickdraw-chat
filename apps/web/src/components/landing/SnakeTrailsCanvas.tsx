"use client";

import * as React from "react";

// ============================================================================
// SnakeTrailsCanvas — the landing hero background.
//
// A handful of autonomous glowing snakes wander a faint dot grid, seek food
// sparks, and drift toward the cursor: the template's multiplayer snake demo
// as ambient art. Deliberately dependency-free Canvas 2D (no three.js) —
// ~60fps for a few polylines is free, and it degrades gracefully:
//   - prefers-reduced-motion → a single static frame
//   - hidden tab / offscreen hero → the loop pauses
// ============================================================================

const COLORS = ["#7c4dff", "#7dcfff", "#f7768e", "#9ece6a", "#bb9af7", "#7aa2f7"];
const BG = "#16161e";
const TRAIL_LENGTH = 46;
const GRID_STEP = 44;
const FOOD_COUNT = 7;

interface Snake {
  x: number;
  y: number;
  angle: number;
  speed: number;
  wanderPhase: number;
  color: string;
  width: number;
  trail: { x: number; y: number }[];
  /** Glow burst timer after eating (seconds remaining). */
  burst: number;
}

interface Food {
  x: number;
  y: number;
  phase: number;
  color: string;
}

interface World {
  w: number;
  h: number;
  snakes: Snake[];
  food: Food[];
  mouse: { x: number; y: number; active: boolean };
  time: number;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function spawnSnake(w: number, h: number, index: number): Snake {
  return {
    x: rand(0, w),
    y: rand(0, h),
    angle: rand(0, Math.PI * 2),
    speed: rand(46, 74),
    wanderPhase: rand(0, Math.PI * 2),
    color: COLORS[index % COLORS.length] ?? COLORS[0],
    width: rand(3, 5),
    trail: [],
    burst: 0,
  };
}

function spawnFood(w: number, h: number): Food {
  return {
    x: rand(w * 0.05, w * 0.95),
    y: rand(h * 0.05, h * 0.95),
    phase: rand(0, Math.PI * 2),
    color: COLORS[Math.floor(rand(0, COLORS.length))] ?? COLORS[0],
  };
}

function createWorld(w: number, h: number): World {
  const count = Math.max(3, Math.min(6, Math.round(w / 320)));
  return {
    w,
    h,
    snakes: Array.from({ length: count }, (_, i) => spawnSnake(w, h, i)),
    food: Array.from({ length: FOOD_COUNT }, () => spawnFood(w, h)),
    mouse: { x: 0, y: 0, active: false },
    time: 0,
  };
}

/** Shortest signed angle from `from` to `to`. */
function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function steerToward(snake: Snake, tx: number, ty: number, weight: number, dt: number): void {
  const target = Math.atan2(ty - snake.y, tx - snake.x);
  snake.angle += angleDelta(snake.angle, target) * weight * dt;
}

function stepSnake(world: World, snake: Snake, dt: number): void {
  // Seeded-feeling wander: slow sinusoidal drift of the heading
  snake.wanderPhase += dt * rand(0.6, 1.4);
  snake.angle += Math.sin(snake.wanderPhase) * 0.9 * dt;

  // Seek the nearest food spark
  let nearest: Food | null = null;
  let nearestDist = Infinity;
  for (const food of world.food) {
    const d = Math.hypot(food.x - snake.x, food.y - snake.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = food;
    }
  }
  if (nearest && nearestDist < 420) {
    steerToward(snake, nearest.x, nearest.y, 2.2, dt);
    if (nearestDist < 14) {
      // Eaten: respawn the spark, flash the snake
      nearest.x = rand(world.w * 0.05, world.w * 0.95);
      nearest.y = rand(world.h * 0.05, world.h * 0.95);
      snake.burst = 0.9;
    }
  }

  // The cursor is quietly interesting
  if (world.mouse.active) {
    const d = Math.hypot(world.mouse.x - snake.x, world.mouse.y - snake.y);
    if (d < 320 && d > 60) steerToward(snake, world.mouse.x, world.mouse.y, 0.8, dt);
  }

  // Soft wall avoidance: steer back toward the center near edges
  const margin = 70;
  if (
    snake.x < margin ||
    snake.y < margin ||
    snake.x > world.w - margin ||
    snake.y > world.h - margin
  ) {
    steerToward(snake, world.w / 2, world.h / 2, 3.0, dt);
  }

  snake.x += Math.cos(snake.angle) * snake.speed * dt;
  snake.y += Math.sin(snake.angle) * snake.speed * dt;
  snake.burst = Math.max(0, snake.burst - dt);

  snake.trail.push({ x: snake.x, y: snake.y });
  if (snake.trail.length > TRAIL_LENGTH) snake.trail.shift();
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "rgba(122, 162, 247, 0.07)";
  for (let x = GRID_STEP / 2; x < w; x += GRID_STEP) {
    for (let y = GRID_STEP / 2; y < h; y += GRID_STEP) {
      ctx.fillRect(x - 0.5, y - 0.5, 1.5, 1.5);
    }
  }
}

function drawFood(ctx: CanvasRenderingContext2D, world: World): void {
  for (const food of world.food) {
    const pulse = 0.55 + 0.45 * Math.sin(world.time * 2.2 + food.phase);
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.4 * pulse;
    ctx.shadowColor = food.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = food.color;
    ctx.beginPath();
    ctx.arc(food.x, food.y, 2.2 + pulse * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: Snake): void {
  const points = snake.trail;
  if (points.length < 2) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = snake.color;

  // Tapered, fading polyline: draw in a few alpha bands tail → head
  const bands = 4;
  const perBand = Math.ceil((points.length - 1) / bands);
  for (let b = 0; b < bands; b++) {
    const start = b * perBand;
    const end = Math.min(points.length - 1, (b + 1) * perBand);
    if (start >= end) continue;
    const t = (b + 1) / bands;
    ctx.beginPath();
    const first = points[start];
    if (!first) continue;
    ctx.moveTo(first.x, first.y);
    for (let i = start + 1; i <= end; i++) {
      const p = points[i];
      if (p) ctx.lineTo(p.x, p.y);
    }
    ctx.globalAlpha = 0.08 + t * (0.5 + snake.burst * 0.5);
    ctx.lineWidth = snake.width * (0.4 + t * 0.6);
    ctx.shadowBlur = 8 + t * 8 + snake.burst * 14;
    ctx.strokeStyle = snake.color;
    ctx.stroke();
  }

  // Head dot
  ctx.globalAlpha = 0.9;
  ctx.shadowBlur = 12 + snake.burst * 16;
  ctx.fillStyle = snake.color;
  ctx.beginPath();
  ctx.arc(snake.x, snake.y, snake.width * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function renderFrame(ctx: CanvasRenderingContext2D, world: World): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, world.w, world.h);
  drawGrid(ctx, world.w, world.h);
  drawFood(ctx, world);
  for (const snake of world.snakes) drawSnake(ctx, snake);
}

function stepWorld(world: World, dt: number): void {
  world.time += dt;
  for (const snake of world.snakes) stepSnake(world, snake, dt);
}

/**
 * Fills its nearest positioned ancestor. Render inside a
 * `position: relative; overflow: hidden` hero container.
 */
export function SnakeTrailsCanvas(): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let world = createWorld(parent.clientWidth, parent.clientHeight);
    let running = true;
    let visible = true;
    let rafId = 0;
    let lastTime = performance.now();

    const applySize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = parent;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      world = createWorld(w, h);
      // Pre-roll so trails exist on the first visible frame
      for (let i = 0; i < TRAIL_LENGTH; i++) stepWorld(world, 1 / 60);
      renderFrame(ctx, world);
    };

    const frame = (now: number): void => {
      if (!running) return;
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      stepWorld(world, dt);
      renderFrame(ctx, world);
      rafId = requestAnimationFrame(frame);
    };

    const setRunning = (next: boolean): void => {
      if (next === running) return;
      running = next;
      if (running) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(rafId);
      }
    };

    const handleVisibility = (): void => {
      setRunning(!document.hidden && visible && !reducedMotion);
    };
    const handleMouseMove = (event: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      world.mouse.x = event.clientX - rect.left;
      world.mouse.y = event.clientY - rect.top;
      world.mouse.active = true;
    };
    const handleMouseLeave = (): void => {
      world.mouse.active = false;
    };

    const resizeObserver = new ResizeObserver(applySize);
    resizeObserver.observe(parent);
    const intersectionObserver = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      handleVisibility();
    });
    intersectionObserver.observe(canvas);

    applySize();
    if (reducedMotion) {
      // Static frame already rendered by applySize
      running = false;
    } else {
      document.addEventListener("visibilitychange", handleVisibility);
      parent.addEventListener("mousemove", handleMouseMove);
      parent.addEventListener("mouseleave", handleMouseLeave);
      rafId = requestAnimationFrame(frame);
    }

    return (): void => {
      running = false;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
      parent.removeEventListener("mousemove", handleMouseMove);
      parent.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
