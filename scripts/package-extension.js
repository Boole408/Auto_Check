import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const extensionName = "auto-cw-importer";
const sourceDir = path.join(projectRoot, "public", extensionName);
const distDir = path.join(projectRoot, "dist");
const distExtensionDir = path.join(distDir, extensionName);
const zipPath = path.join(distDir, "auto-cw-importer-extension.zip");

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function listFiles(dir, baseDir = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listFiles(absolutePath, baseDir);
      return [
        {
          absolutePath,
          archivePath: path
            .relative(baseDir, absolutePath)
            .split(path.sep)
            .join("/")
        }
      ];
    })
    .sort((left, right) => left.archivePath.localeCompare(right.archivePath));
}

function createZip(files, outputPath) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.absolutePath);
    const filename = Buffer.from(`${extensionName}/${file.archivePath}`, "utf8");
    const stats = fs.statSync(file.absolutePath);
    const { dosTime, dosDate } = dosDateTime(stats.mtime);
    const checksum = crc32(data);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(filename.length),
      writeUInt16(0),
      filename
    ]);

    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(0),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(data.length),
      writeUInt32(data.length),
      writeUInt16(filename.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(offset),
      filename
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(files.length),
    writeUInt16(files.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);

  fs.writeFileSync(outputPath, Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]));
}

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Missing extension source: ${sourceDir}`);
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(distExtensionDir, { recursive: true, force: true });
fs.cpSync(sourceDir, distExtensionDir, { recursive: true, force: true });

createZip(listFiles(sourceDir), zipPath);
console.log(`Extension package prepared at ${zipPath}`);
