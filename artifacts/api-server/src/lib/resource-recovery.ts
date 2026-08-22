export type StoredResourceMetadata = {
  size?: string | number;
  contentType?: string;
};

type StoredResourceFile = {
  getMetadata(): Promise<[StoredResourceMetadata, ...unknown[]]>;
};

type StoredResourceLookup = (objectPath: string) => Promise<StoredResourceFile>;

export type StoredResourceRegistration = {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string | null;
  recoveryMethod: string;
};

type RegisterStoredResource = (registration: StoredResourceRegistration) => Promise<void>;

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

/**
 * Complete the database side of an upload that finished before its resource
 * row was persisted. The caller supplies the row update so this recovery
 * logic stays independent of the database implementation.
 */
export async function resumeStoredResourceImport(
  objectPath: string,
  options: {
    mimeType: string;
    existingChecksum?: string | null;
    existingRecoveryMethod?: string | null;
    getStoredResource: StoredResourceLookup;
    registerStoredResource: RegisterStoredResource;
  },
): Promise<boolean> {
  const stored = await inspectStoredResource(objectPath, options.getStoredResource);
  if (!stored) return false;

  await options.registerStoredResource({
    storagePath: objectPath,
    mimeType: options.mimeType || stored.contentType,
    sizeBytes: stored.sizeBytes,
    checksum: options.existingChecksum ?? null,
    recoveryMethod: options.existingRecoveryMethod ?? "storage_resume",
  });
  return true;
}