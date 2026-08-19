export type StoredResourceMetadata = {
  size?: string | number;
  contentType?: string;
};

type StoredResourceFile = {
  getMetadata(): Promise<[StoredResourceMetadata, ...unknown[]]>;
};

type StoredResourceLookup = (objectPath: string) => Promise<StoredResourceFile>;

export async function inspectStoredResource(
  objectPath: string,
  getStoredResource: StoredResourceLookup,
): Promise<{ sizeBytes: number; contentType: string } | null> {
  try {
    const file = await getStoredResource(objectPath);
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size ?? 0);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
    return {
      sizeBytes,
      contentType: String(metadata.contentType ?? "application/octet-stream"),
    };
  } catch {
    return null;
  }
}