/**
 * Divergence & fidelity metrics.
 *
 * - Inter-client divergence: same entity, same wall instant, two clients'
 *   rendered positions. `remoteVsRemote` (neither client owns the entity) is
 *   the purest desync signal — with consistent interpolation it should be
 *   near zero. `ownVsRemote` compares the owner's predicted-now view against
 *   another client's delayed-interpolated view, so it is dominated by the
 *   intentional interpolation delay plus transport.
 * - Render latency: the time lag L that best aligns a client's render of an
 *   entity with the authoritative server track (staleness incl. interp
 *   delay). The residual error at that lag is trajectory fidelity.
 */

import type { ClientTrace, EntityFidelity, ServerTrace, Stats } from "../types.js";
import {
  buildClientTracks,
  buildDiscontinuityMask,
  buildServerTracks,
  computeStats,
  GRID_HZ,
  sampleTrack,
  type Track,
} from "./tracks.js";

const LAG_SEARCH_MAX_MS = 600;
const LAG_SEARCH_STEP_MS = 5;

export interface DivergenceResult {
  ownVsRemotePx: Stats;
  remoteVsRemotePx: Stats;
}

export function computeDivergence(
  clients: ClientTrace[],
  server: ServerTrace,
  windowStart: number,
  windowEnd: number,
): DivergenceResult {
  const masked = buildDiscontinuityMask(server);
  const tracksByClient = clients.map((c) => ({ trace: c, tracks: buildClientTracks(c) }));
  const ownVsRemote: number[] = [];
  const remoteVsRemote: number[] = [];
  const stepMs = 1000 / GRID_HZ;

  const compareEntity = (entityId: string, trackA: Track, trackB: Track, sink: number[]): void => {
    for (let t = windowStart; t <= windowEnd; t += stepMs) {
      if (masked(entityId, t)) continue;
      const pa = sampleTrack(trackA, t);
      const pb = sampleTrack(trackB, t);
      if (!pa || !pb) continue;
      sink.push(Math.hypot(pa.x - pb.x, pa.y - pb.y));
    }
  };

  for (let a = 0; a < tracksByClient.length; a++) {
    for (let b = a + 1; b < tracksByClient.length; b++) {
      const A = tracksByClient[a];
      const B = tracksByClient[b];
      if (!A || !B) continue;
      for (const [entityId, trackA] of A.tracks) {
        const trackB = B.tracks.get(entityId);
        if (!trackB) continue;
        const isOwn = entityId === A.trace.playerId || entityId === B.trace.playerId;
        compareEntity(entityId, trackA, trackB, isOwn ? ownVsRemote : remoteVsRemote);
      }
    }
  }

  return {
    ownVsRemotePx: computeStats(ownVsRemote),
    remoteVsRemotePx: computeStats(remoteVsRemote),
  };
}

export interface FidelityResult {
  perEntity: Record<string, EntityFidelity>;
  predictionErrorPx?: Stats;
}

/** Mean |client(t) − server(t − lag)| over the grid; null if too few points. */
function errorsAtLag(
  clientTrack: Track,
  serverTrack: Track,
  lagMs: number,
  windowStart: number,
  windowEnd: number,
  masked: (t: number) => boolean,
): number[] {
  const stepMs = 1000 / GRID_HZ;
  const errors: number[] = [];
  for (let t = windowStart; t <= windowEnd; t += stepMs) {
    if (masked(t)) continue;
    const pc = sampleTrack(clientTrack, t);
    const ps = sampleTrack(serverTrack, t - lagMs);
    if (!pc || !ps) continue;
    errors.push(Math.hypot(pc.x - ps.x, pc.y - ps.y));
  }
  return errors;
}

export function computeFidelity(
  client: ClientTrace,
  server: ServerTrace,
  windowStart: number,
  windowEnd: number,
): FidelityResult {
  const maskFor = buildDiscontinuityMask(server);
  const clientTracks = buildClientTracks(client);
  const serverTracks = buildServerTracks(server);
  const perEntity: Record<string, EntityFidelity> = {};
  let predictionErrorPx: Stats | undefined;

  for (const [entityId, clientTrack] of clientTracks) {
    const serverTrack = serverTracks.get(entityId);
    if (!serverTrack) continue;
    const masked = (t: number) => maskFor(entityId, t);

    let bestLag = 0;
    let bestMean = Infinity;
    for (let lag = 0; lag <= LAG_SEARCH_MAX_MS; lag += LAG_SEARCH_STEP_MS) {
      const errors = errorsAtLag(clientTrack, serverTrack, lag, windowStart, windowEnd, masked);
      if (errors.length < 30) continue;
      const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
      if (mean < bestMean) {
        bestMean = mean;
        bestLag = lag;
      }
    }
    if (bestMean === Infinity) continue;

    const residual = errorsAtLag(clientTrack, serverTrack, bestLag, windowStart, windowEnd, masked);
    perEntity[entityId] = { renderLatencyMs: bestLag, shapeErrorPx: computeStats(residual) };

    if (entityId === client.playerId) {
      predictionErrorPx = computeStats(
        errorsAtLag(clientTrack, serverTrack, 0, windowStart, windowEnd, masked),
      );
    }
  }

  return predictionErrorPx === undefined ? { perEntity } : { perEntity, predictionErrorPx };
}
