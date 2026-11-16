// bump-version.ts
import { readFileSync, writeFileSync } from "fs";
import { parse as parseToml, stringify as stringifyToml } from "toml"; // หรือใช้ regex ง่ายๆ ถ้าไม่อยากลงแพ็กเกจเพิ่ม

// รับค่าเวอร์ชันใหม่จาก Argument ที่ส่งเข้ามา (เช่น bun run bump.ts 0.4.0)
const newVersion = process.argv[2];

if (!newVersion) {
  console.error("❌ กรุณาระบุเวอร์ชันใหม่ด้วย เช่น: bun run bump-version.ts 0.4.0");
  process.exit(1);
}

console.log(`🔄 กำลังซิงค์เวอร์ชันเป็น: ${newVersion}...`);

// 1. อัปเดต package.json
const packageJsonPath = "./package.json";
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");
console.log("✔️ อัปเดต package.json สำเร็จ");

// 2. อัปเดต tauri.config.json (หรือ tauri.conf.json ตามเวอร์ชันของ Tauri)
const tauriConfigPath = "./src-tauri/tauri.conf.json";
try {
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf-8"));
  tauriConfig.version = newVersion;
  writeFileSync(tauriConfigPath, JSON.stringify(tauriConfig, null, 2) + "\n");
  console.log("✔️ อัปเดต tauri.config.json สำเร็จ");
} catch (e) {
  console.log("⚠️ ข้าม tauri.config.json (ไม่พบไฟล์หรือโครงสร้างอาจต่างกัน)");
}

// 3. อัปเดต Cargo.toml (ใช้ Regex ค้นหาและแทนที่เวอร์ชันบรรทัดแรกๆ)
const cargoTomlPath = "./src-tauri/Cargo.toml";
let cargoContent = readFileSync(cargoTomlPath, "utf-8");
cargoContent = cargoContent.replace(
  /^version\s*=\s*"[^"]*"/m,
  `version = "${newVersion}"`
);
writeFileSync(cargoTomlPath, cargoContent, "utf-8");
console.log("✔️ อัปเดต Cargo.toml สำเร็จ");

console.log(`🎉 ซิงค์เวอร์ชัน ${newVersion} ทุกไฟล์เรียบร้อยแล้ว!`);