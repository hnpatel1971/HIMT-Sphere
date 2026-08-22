import { execFile } from "child_process";
import { randomBytes, randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import type { File } from "@google-cloud/storage";

export type ProtectedHlsPackage = {
  id: string;
  rootDir: string;
  manifestPath: string;
  keyPath: string;
  expiresAt: Date;
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("ffmpeg", args, { maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`Adaptive video packaging failed: ${stderr.trim() || error.message}`));
      else resolve();
    });
  });
}

/**
 * Packages a private source file into a short-lived encrypted HLS VOD package.
 * The input is deleted after packaging; callers expose only manifest, key and
 * segment routes that re-authorize the protected viewer session.
 */
export async function prepareProtectedHls(
  file: File,
  keyUri: string,
  expiresAt: Date,
  encryptionKey: Buffer,
): Promise<ProtectedHlsPackage> {
  const rootDir = await mkdtemp(join(tmpdir(), "himt-hls-"));
  const inputPath = join(rootDir, "source");
  const keyPath = join(rootDir, "content.key");
  const keyInfoPath = join(rootDir, "key.info");
  const manifestPath = join(rootDir, "manifest.m3u8");
  if (encryptionKey.length !== 16) throw new Error("Protected HLS encryption key must be 16 bytes");

  try {
    await pipeline(file.createReadStream(), createWriteStream(inputPath));
    await writeFile(keyPath, encryptionKey);
    await writeFile(keyInfoPath, `${keyUri}\n${keyPath}\n`);
    await runFfmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", inputPath,
      "-map", "0:v:0?", "-map", "0:a:0?",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
      "-f", "hls", "-hls_time", "6", "-hls_playlist_type", "vod",
      "-hls_flags", "independent_segments",
      "-hls_key_info_file", keyInfoPath,
      "-hls_segment_filename", join(rootDir, "segment-%05d.ts"),
      manifestPath,
    ]);
    await rm(inputPath, { force: true });
    return {
      id: randomUUID(),
      rootDir,
      manifestPath,
      keyPath,
      expiresAt,
    };
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readProtectedHlsFile(packageInfo: ProtectedHlsPackage, filename: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) throw new Error("Invalid playback file");
  return readFile(join(packageInfo.rootDir, filename));
}

export async function removeProtectedHls(packageInfo: ProtectedHlsPackage): Promise<void> {
  await rm(packageInfo.rootDir, { recursive: true, force: true }).catch(() => undefined);
}