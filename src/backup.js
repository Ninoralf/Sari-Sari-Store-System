import crypto from "node:crypto";

const ZIP_SIGNATURE_LOCAL = 0x04034b50;
const ZIP_SIGNATURE_CENTRAL = 0x02014b50;
const ZIP_SIGNATURE_END = 0x06054b50;
const BACKUP_APP_NAME = "Sari-Sari Store Management System";
const BACKUP_FORMAT_VERSION = "2";
const LEGACY_BACKUP_EXTENSIONS = new Set([".db", ".sqlite"]);

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUInt32LE(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function writeUInt16LE(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function createZipEntry(name, data, offset) {
  const fileName = Buffer.from(name, "utf8");
  const body = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const checksum = crc32(body);
  const localHeader = Buffer.concat([
    writeUInt32LE(ZIP_SIGNATURE_LOCAL),
    writeUInt16LE(20),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(checksum),
    writeUInt32LE(body.length),
    writeUInt32LE(body.length),
    writeUInt16LE(fileName.length),
    writeUInt16LE(0),
    fileName
  ]);
  const centralHeader = Buffer.concat([
    writeUInt32LE(ZIP_SIGNATURE_CENTRAL),
    writeUInt16LE(20),
    writeUInt16LE(20),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(checksum),
    writeUInt32LE(body.length),
    writeUInt32LE(body.length),
    writeUInt16LE(fileName.length),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt32LE(0),
    writeUInt32LE(offset),
    fileName
  ]);

  return {
    localRecord: Buffer.concat([localHeader, body]),
    centralRecord: centralHeader
  };
}

export function createBackupZip(files) {
  let offset = 0;
  const localRecords = [];
  const centralRecords = [];

  for (const file of files) {
    const entry = createZipEntry(file.name, file.data, offset);
    localRecords.push(entry.localRecord);
    centralRecords.push(entry.centralRecord);
    offset += entry.localRecord.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = Buffer.concat([
    writeUInt32LE(ZIP_SIGNATURE_END),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(files.length),
    writeUInt16LE(files.length),
    writeUInt32LE(centralDirectory.length),
    writeUInt32LE(offset),
    writeUInt16LE(0)
  ]);

  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

export function parseBackupZip(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const files = new Map();
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === ZIP_SIGNATURE_END) break;
    if (signature !== ZIP_SIGNATURE_LOCAL) {
      throw new Error("Corrupted backup file.");
    }

    if (offset + 30 > buffer.length) {
      throw new Error("Corrupted backup file.");
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const checksum = buffer.readUInt32LE(offset + 14);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;

    if (compressionMethod !== 0 || compressedSize !== uncompressedSize || dataEnd > buffer.length) {
      throw new Error("Corrupted backup file.");
    }

    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    const data = buffer.subarray(dataStart, dataEnd);

    if (crc32(data) !== checksum) {
      throw new Error("Corrupted backup file.");
    }

    files.set(name, Buffer.from(data));
    offset = dataEnd;
  }

  if (!files.size) {
    throw new Error("Invalid backup file.");
  }

  return files;
}

export function parseJsonFile(buffer, fallbackMessage) {
  try {
    return JSON.parse(Buffer.from(buffer).toString("utf8"));
  } catch {
    throw new Error(fallbackMessage);
  }
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function buildBackupMetadata({ version, schemaVersion, createdBy, checksums }) {
  return {
    appName: BACKUP_APP_NAME,
    version,
    backupDate: new Date().toISOString(),
    schemaVersion,
    createdBy,
    formatVersion: BACKUP_FORMAT_VERSION,
    checksums
  };
}

export function getBackupAppName() {
  return BACKUP_APP_NAME;
}

export function getBackupFormatVersion() {
  return BACKUP_FORMAT_VERSION;
}

export function isLegacyBackupFileName(fileName = "") {
  const normalized = String(fileName || "").trim().toLowerCase();
  return [...LEGACY_BACKUP_EXTENSIONS].some((extension) => normalized.endsWith(extension));
}
