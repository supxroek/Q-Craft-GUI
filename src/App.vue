<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  Table as TableIcon,
  Search,
  Play,
  Copy,
  Check,
  Plus,
  Trash2,
  Link2,
  Settings,
  Code2,
  Eye,
  Sparkles,
  BookOpen,
} from "lucide-vue-next";
import type {
  AppConfig,
  ColumnDetail,
  ForeignKeyRelation,
  JoinType,
  PreviewResult,
  QueryAst,
  SchemaDictionary,
  TableInfo,
} from "./types/qcraft";

// ============================================================================
// 1. State Management
// ============================================================================
const isConnected = ref(false);
const isConnecting = ref(false);
const showConnModal = ref(true);
const errorMsg = ref<string | null>(null);

const config = ref<AppConfig>({
  host: "spc805srv",
  port: 1433,
  database: "",
  auth_mode: "SqlServer",
  username: "sa",
  password: "",
  trust_cert: true,
  default_preview_limit: 10,
  global_rules: [],
});

const dictionary = ref<SchemaDictionary>({ tables: {} });
const databases = ref<string[]>([]);
const selectedDb = ref<string>("");
const tables = ref<TableInfo[]>([]);
const tableSearch = ref<string>("");
const isLoadingTables = ref(false);

// โครงสร้างตารางที่โหลดเข้ามาใน Query ปัจจุบัน (key = table_alias)
interface LoadedTable {
  database: string;
  schema: string;
  name: string;
  alias: string;
  columns: ColumnDetail[];
  fks: ForeignKeyRelation[];
}

const loadedTables = ref<LoadedTable[]>([]);
const ast = ref<QueryAst | null>(null);
const columnSearch = ref("");

// Modal สำหรับเพิ่ม JOIN
const showJoinModal = ref(false);
const joinTargetDb = ref("");
const joinTargetTables = ref<TableInfo[]>([]);
const joinTargetTable = ref<TableInfo | null>(null);
const joinTargetCols = ref<ColumnDetail[]>([]);
const joinType = ref<JoinType>("Left");
const joinAlias = ref("");
const joinLeftCol = ref(""); // format: "alias.col"
const joinRightCol = ref(""); // format: "col"

// Bottom Panel (Live Preview & Multi-Language Export)
const bottomTab = ref<"preview" | "export">("preview");
const previewData = ref<PreviewResult | null>(null);
const isRunningPreview = ref(false);
const exportTarget = ref<"csharp_bundle" | "csharp" | "pure_sql" | "typescript">("csharp_bundle");
const exportedCode = ref("");
const copied = ref(false);
const appVersion = ref("");

// ============================================================================
// 2. Lifecycle & Database Connection
// ============================================================================
onMounted(async () => {
  try {
    const saved = await invoke<AppConfig>("load_saved_config");
    config.value = saved;
    const dict = await invoke<SchemaDictionary>("get_dictionary");
    dictionary.value = dict;

    const version: string = await invoke("get_app_version");
    appVersion.value = `v${version}`;
  } catch (e) {
    console.error("Failed to load config:", e);
  }
});

async function handleConnect() {
  isConnecting.value = true;
  errorMsg.value = null;
  try {
    const dbList = await invoke<string[]>("connect_database", { config: config.value });
    databases.value = dbList;
    isConnected.value = true;
    showConnModal.value = false;

    const initialDb =
      dbList.find((d) => d.toLowerCase() === config.value.database.toLowerCase()) || dbList[0] || "";
    if (initialDb) {
      await selectDatabase(initialDb);
    }
  } catch (e: any) {
    errorMsg.value = String(e);
  } finally {
    isConnecting.value = false;
  }
}

async function selectDatabase(dbName: string) {
  selectedDb.value = dbName;
  isLoadingTables.value = true;
  try {
    tables.value = await invoke<TableInfo[]>("get_tables", { database: dbName });
  } catch (e: any) {
    errorMsg.value = String(e);
  } finally {
    isLoadingTables.value = false;
  }
}

const filteredTables = computed(() => {
  if (!tableSearch.value.trim()) return tables.value;
  const q = tableSearch.value.toLowerCase();
  return tables.value.filter((t) => t.name.toLowerCase().includes(q));
});

// ============================================================================
// 3. Smart Semantic Aliasing & Query Builder Actions
// ============================================================================
function generateSmartAlias(tableName: string): string {
  const used = new Set(loadedTables.value.map((t) => t.alias.toLowerCase()));
  const cleaned = tableName
    .toUpperCase()
    .replace(/^(TBL_|TB_|VW_)/, "")
    .replace(/(_TEMP|_TMP|TEMP|TMP)$/, "");

  let words: string[] = [];
  for (const part of cleaned.split(/[^A-Z0-9]+/)) {
    if (!part) continue;
    if (part.length > 2 && (part.endsWith("HD") || part.endsWith("DT"))) {
      words.push(part.slice(0, -2), part.slice(-2));
    } else {
      words.push(part);
    }
  }

  let base = "t";
  if (words.length >= 2) {
    const last = words[words.length - 1];
    if (last === "HD" || last === "DT") {
      const prefix = words
        .slice(0, -1)
        .map((w) => w[0])
        .join("")
        .toLowerCase();
      base = `${prefix}_${last.toLowerCase()}`;
    } else {
      base = words
        .map((w) => w[0])
        .slice(0, 3)
        .join("")
        .toLowerCase();
    }
  } else if (words.length === 1) {
    const lower = words[0].toLowerCase();
    for (let len = 1; len <= Math.min(4, lower.length); len++) {
      const slice = lower.slice(0, len);
      if (!used.has(slice)) return slice;
    }
    base = lower.slice(0, 3);
  }

  if (!used.has(base)) return base;
  let counter = 2;
  while (used.has(`${base}${counter}`)) counter++;
  return `${base}${counter}`;
}

async function setMainTable(tbl: TableInfo) {
  errorMsg.value = null;
  try {
    const [cols, fks] = await invoke<[ColumnDetail[], ForeignKeyRelation[]]>("get_table_details", {
      database: selectedDb.value,
      schema: tbl.schema,
      table: tbl.name,
    });

    loadedTables.value = [];
    const alias = generateSmartAlias(tbl.name);

    loadedTables.value.push({
      database: selectedDb.value,
      schema: tbl.schema,
      name: tbl.name,
      alias,
      columns: cols,
      fks,
    });

    ast.value = {
      main_table: {
        database: selectedDb.value,
        schema: tbl.schema,
        name: tbl.name,
        alias,
      },
      joins: [],
      select_columns: [],
      where_conditions: [],
      group_by: [],
      order_by: [],
      top_limit: null,
    };

    applyGlobalRules(alias, cols);
    previewData.value = null;
    await refreshExportCode();
  } catch (e: any) {
    errorMsg.value = String(e);
  }
}

function applyGlobalRules(alias: string, cols: ColumnDetail[]) {
  if (!ast.value || !config.value.global_rules.length) return;
  for (const col of cols) {
    for (const rule of config.value.global_rules) {
      if (col.name.toLowerCase() === rule.column_name.toLowerCase()) {
        ast.value.where_conditions.push({
          column: { table_alias: alias, column_name: col.name },
          operator: "Eq",
          value: { Static: { raw_value: rule.value, is_numeric: rule.is_numeric } },
          is_auto_rule: true,
        });
      }
    }
  }
}

// ============================================================================
// 4. Visual JOIN Modal Logic (Cross-Database & Context-Aware)
// ============================================================================
async function openJoinModal(preselectedTable?: TableInfo) {
  if (!ast.value) return;
  showJoinModal.value = true;
  joinTargetDb.value = selectedDb.value;
  joinTargetTables.value = tables.value;
  joinTargetTable.value = null;
  joinTargetCols.value = [];
  joinLeftCol.value = allAvailableColumns.value[0]?.fullName || "";
  joinRightCol.value = "";

  if (preselectedTable) {
    await onSelectJoinTargetTable(preselectedTable);
  }
}

async function onChangeJoinDb(db: string) {
  joinTargetDb.value = db;
  joinTargetTable.value = null;
  joinTargetCols.value = [];
  joinTargetTables.value = await invoke<TableInfo[]>("get_tables", { database: db });
}

async function onSelectJoinTargetTable(tbl: TableInfo) {
  joinTargetTable.value = tbl;
  joinAlias.value = generateSmartAlias(tbl.name);
  const [cols] = await invoke<[ColumnDetail[], ForeignKeyRelation[]]>("get_table_details", {
    database: joinTargetDb.value,
    schema: tbl.schema,
    table: tbl.name,
  });
  joinTargetCols.value = cols;

  const mainCtx = loadedTables.value[0];
  if (mainCtx && joinTargetDb.value.toLowerCase() === mainCtx.database.toLowerCase()) {
    const fk = mainCtx.fks.find(
      (f) =>
        f.to_table.toLowerCase() === tbl.name.toLowerCase() ||
        f.from_table.toLowerCase() === tbl.name.toLowerCase()
    );
    if (fk) {
      if (fk.from_table.toLowerCase() === mainCtx.name.toLowerCase()) {
        joinLeftCol.value = `${mainCtx.alias}.${fk.from_column}`;
        joinRightCol.value = fk.to_column;
      } else {
        joinLeftCol.value = `${mainCtx.alias}.${fk.to_column}`;
        joinRightCol.value = fk.from_column;
      }
      return;
    }
  }

  joinRightCol.value = cols[0]?.name || "";
}

function confirmAddJoin() {
  if (!ast.value || !joinTargetTable.value || !joinLeftCol.value || !joinRightCol.value) return;
  const [leftAlias, leftColName] = joinLeftCol.value.split(".");

  ast.value.joins.push({
    join_type: joinType.value,
    target_table: {
      database: joinTargetDb.value,
      schema: joinTargetTable.value.schema,
      name: joinTargetTable.value.name,
      alias: joinAlias.value,
    },
    left_column: { table_alias: leftAlias, column_name: leftColName },
    right_column: { table_alias: joinAlias.value, column_name: joinRightCol.value },
  });

  loadedTables.value.push({
    database: joinTargetDb.value,
    schema: joinTargetTable.value.schema,
    name: joinTargetTable.value.name,
    alias: joinAlias.value,
    columns: joinTargetCols.value,
    fks: [],
  });

  applyGlobalRules(joinAlias.value, joinTargetCols.value);
  showJoinModal.value = false;
  refreshExportCode();
}

function removeJoin(index: number) {
  if (!ast.value) return;
  const removed = ast.value.joins.splice(index, 1)[0];
  const alias = removed.target_table.alias;
  loadedTables.value = loadedTables.value.filter((t) => t.alias !== alias);
  ast.value.select_columns = ast.value.select_columns.filter((c) => c.column.table_alias !== alias);
  ast.value.where_conditions = ast.value.where_conditions.filter((w) => w.column.table_alias !== alias);
  ast.value.order_by = ast.value.order_by.filter((o) => o.column.table_alias !== alias);
  refreshExportCode();
}

// ============================================================================
// 5. Column Selection, Filters, Grouping & Sorting
// ============================================================================
const allAvailableColumns = computed(() => {
  const list: {
    tableName: string;
    tableAlias: string;
    fullName: string;
    detail: ColumnDetail;
    note?: { description: string; suggested_alias: string | null };
  }[] = [];
  for (const tbl of loadedTables.value) {
    const tblDict = Object.entries(dictionary.value.tables).find(
      ([k]) => k.toLowerCase() === tbl.name.toLowerCase()
    )?.[1];
    for (const col of tbl.columns) {
      const note = tblDict
        ? Object.entries(tblDict).find(([k]) => k.toLowerCase() === col.name.toLowerCase())?.[1]
        : undefined;
      list.push({
        tableName: tbl.name,
        tableAlias: tbl.alias,
        fullName: `${tbl.alias}.${col.name}`,
        detail: col,
        note,
      });
    }
  }
  return list;
});

const filteredColumns = computed(() => {
  if (!columnSearch.value.trim()) return allAvailableColumns.value;
  const q = columnSearch.value.toLowerCase();
  return allAvailableColumns.value.filter(
    (c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.note?.description.toLowerCase().includes(q) ||
      c.detail.sample_values.some((s) => s.toLowerCase().includes(q))
  );
});

function isColumnSelected(alias: string, colName: string): boolean {
  return (
    ast.value?.select_columns.some(
      (s) => s.column.table_alias === alias && s.column.column_name === colName
    ) || false
  );
}

function getSelectedField(alias: string, colName: string) {
  return ast.value?.select_columns.find(
    (s) => s.column.table_alias === alias && s.column.column_name === colName
  );
}

function toggleSelectColumn(item: (typeof allAvailableColumns.value)[0]) {
  if (!ast.value) return;
  const idx = ast.value.select_columns.findIndex(
    (s) => s.column.table_alias === item.tableAlias && s.column.column_name === item.detail.name
  );
  if (idx >= 0) {
    ast.value.select_columns.splice(idx, 1);
  } else {
    ast.value.select_columns.push({
      column: { table_alias: item.tableAlias, column_name: item.detail.name },
      output_alias: item.note?.suggested_alias || null,
      aggregate: "None",
      sql_data_type: item.detail.data_type,
    });
  }
  syncGroupBy();
  refreshExportCode();
}

function syncGroupBy() {
  if (!ast.value) return;
  const hasAgg = ast.value.select_columns.some((c) => c.aggregate !== "None");
  if (hasAgg) {
    ast.value.group_by = ast.value.select_columns
      .filter((c) => c.aggregate === "None")
      .map((c) => ({ ...c.column }));
  } else {
    ast.value.group_by = [];
  }
}

function isNumericType(sqlType: string): boolean {
  return [
    "int",
    "bigint",
    "smallint",
    "tinyint",
    "bit",
    "decimal",
    "numeric",
    "money",
    "float",
    "real",
  ].includes(sqlType.toLowerCase());
}

function addWhereCondition() {
  if (!ast.value || allAvailableColumns.value.length === 0) return;
  const first = allAvailableColumns.value[0];
  const isNum = isNumericType(first.detail.data_type);
  ast.value.where_conditions.push({
    column: { table_alias: first.tableAlias, column_name: first.detail.name },
    operator: "Eq",
    value: {
      Parameter: {
        param_name: first.detail.name,
        sample_value: first.detail.sample_values[0] || "",
        is_numeric: isNum,
      },
    },
    is_auto_rule: false,
  });
  refreshExportCode();
}

function toggleWhereMode(idx: number) {
  if (!ast.value) return;
  const cond = ast.value.where_conditions[idx];
  const colMeta = allAvailableColumns.value.find(
    (c) => c.tableAlias === cond.column.table_alias && c.detail.name === cond.column.column_name
  );
  const isNum = colMeta ? isNumericType(colMeta.detail.data_type) : false;
  if (typeof cond.value === "object" && "Parameter" in cond.value) {
    cond.value = {
      Static: {
        raw_value: cond.value.Parameter.sample_value || "",
        is_numeric: isNum,
      },
    };
  } else {
    const oldVal =
      typeof cond.value === "object" && "Static" in cond.value ? cond.value.Static.raw_value : "";
    cond.value = {
      Parameter: {
        param_name: cond.column.column_name,
        sample_value: oldVal,
        is_numeric: isNum,
      },
    };
  }
  refreshExportCode();
}

function addOrderBy() {
  if (!ast.value || allAvailableColumns.value.length === 0) return;
  const first = allAvailableColumns.value[0];
  ast.value.order_by.push({
    column: { table_alias: first.tableAlias, column_name: first.detail.name },
    direction: "Desc",
  });
  refreshExportCode();
}

// ============================================================================
// 6. Live Preview & Code Export
// ============================================================================
async function runPreview() {
  if (!ast.value) return;
  isRunningPreview.value = true;
  bottomTab.value = "preview";
  errorMsg.value = null;
  try {
    previewData.value = await invoke("preview_query_data", {
      ast: ast.value,
      limit: config.value.default_preview_limit,
    });
  } catch (e: any) {
    errorMsg.value = String(e);
  } finally {
    isRunningPreview.value = false;
  }
}

async function refreshExportCode() {
  if (!ast.value) return;
  exportedCode.value = await invoke("compile_and_export", {
    ast: ast.value,
    target: exportTarget.value,
  });
}

async function copyCodeToClipboard() {
  if (!exportedCode.value) return;
  await navigator.clipboard.writeText(exportedCode.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="flex h-screen w-screen bg-slate-950 text-slate-100 font-sans overflow-hidden select-none">
    <!-- ========================================== -->
    <!-- ZONE 1: Left Sidebar (Explorer & Presets)  -->
    <!-- ========================================== -->
    <aside class="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <!-- Header -->
      <div class="p-3 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full" :class="isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'"></div>
          <span class="font-bold text-xs tracking-wider text-slate-200">QCraft Workbench</span>
        </div>
        <span class="text-[10px] bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-800/50">{{ appVersion }} GUI</span>
      </div>

      <!-- Server & DB Selector -->
      <div class="p-3 border-b border-slate-800 space-y-2">
        <div class="flex items-center justify-between text-xs text-slate-400">
          <span>Server: <strong class="text-slate-200">{{ config.host }}</strong></span>
          <button
            @click="showConnModal = true"
            class="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-md border border-slate-700 transition"
          >
            <Settings class="w-3.5 h-3.5 text-slate-400" />
            Connection
          </button>
        </div>

        <div v-if="isConnected" class="space-y-1">
          <label class="text-[11px] font-semibold text-slate-400 uppercase">Database</label>
          <select
            v-model="selectedDb"
            @change="selectDatabase(selectedDb)"
            class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
          >
            <option v-for="db in databases" :key="db" :value="db">{{ db }}</option>
          </select>
        </div>
      </div>

      <!-- Search Box -->
      <div class="p-3 border-b border-slate-800">
        <div class="relative">
          <Search class="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            v-model="tableSearch"
            type="text"
            placeholder="ค้นหาตาราง..."
            class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs pl-8 pr-2.5 py-2 rounded-md text-slate-200 outline-none placeholder-slate-500"
          />
        </div>
      </div>

      <!-- Table List Explorer -->
      <div class="flex-1 overflow-y-auto p-2 space-y-1">
        <div v-if="isLoadingTables" class="text-center text-xs text-slate-500 py-4">กำลังโหลดรายชื่อตาราง...</div>
        <div
          v-for="tbl in filteredTables"
          :key="`${tbl.schema}.${tbl.name}`"
          class="group flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-slate-800/80 text-xs transition cursor-pointer"
          :class="{
            'bg-indigo-950/60 text-indigo-300 border border-indigo-800/50':
              ast?.main_table.name === tbl.name && ast?.main_table.database === selectedDb,
          }"
          @click="setMainTable(tbl)"
        >
          <div class="flex items-center gap-2 truncate">
            <TableIcon class="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span class="truncate">{{ tbl.name }}</span>
          </div>
          <button
            v-if="ast"
            @click.stop="openJoinModal(tbl)"
            title="นำตารางนี้มา JOIN"
            class="opacity-0 group-hover:opacity-100 bg-slate-700 hover:bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded transition"
          >
            + Join
          </button>
        </div>
      </div>
    </aside>

    <!-- ========================================== -->
    <!-- ZONE 2: Center/Top (Visual Query Canvas)   -->
    <!-- ========================================== -->
    <main class="flex-1 flex flex-col min-w-0 bg-slate-950">
      <!-- Error Notification Banner -->
      <div v-if="errorMsg" class="bg-rose-950/80 border-b border-rose-800 p-3 text-xs text-rose-200 flex items-center justify-between">
        <span>⚠️ {{ errorMsg }}</span>
        <button @click="errorMsg = null" class="text-rose-400 hover:text-white ml-4">✕</button>
      </div>

      <!-- Canvas Header / Query Builder Area -->
      <div class="flex-1 border-b border-slate-800 p-4 overflow-y-auto space-y-4">
        
        <!-- Welcome state if no main table -->
        <div v-if="!ast" class="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
          <div class="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-indigo-400">
            <Sparkles class="w-6 h-6" />
          </div>
          <h2 class="text-sm font-semibold text-slate-300">ยังไม่ได้เลือกตารางหลัก (Main Table)</h2>
          <p class="text-xs text-slate-500 max-w-sm">คลิกเลือกตารางจากแถบด้านซ้ายเพื่อเริ่มสร้าง Query ออกแบบการ JOIN และเลือกคอลัมน์ได้อย่างรวดเร็ว</p>
        </div>

        <!-- Active Query Builder -->
        <template v-else>
          <!-- 1. FROM & JOINs Card -->
          <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Database class="w-4 h-4 text-indigo-400" />
                <span>Tables & Relationships (FROM / JOIN)</span>
              </div>
              <button
                @click="openJoinModal()"
                class="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-md transition"
              >
                <Plus class="w-3.5 h-3.5" />
                Add JOIN (ข้าม DB ได้)
              </button>
            </div>

            <!-- Table Flow Visualizer -->
            <div class="space-y-2 pt-1 font-mono text-xs">
              <!-- Main Table -->
              <div class="bg-slate-950 border border-indigo-900/50 rounded p-2 flex items-center justify-between text-indigo-300">
                <span>FROM [{{ ast.main_table.database }}].[{{ ast.main_table.schema }}].[{{ ast.main_table.name }}] AS <strong class="text-white">{{ ast.main_table.alias }}</strong></span>
                <span class="text-[10px] bg-indigo-950 px-2 py-0.5 rounded text-indigo-400">Main Table</span>
              </div>

              <!-- Joins -->
              <div v-for="(j, idx) in ast.joins" :key="idx" class="bg-slate-950 border border-slate-800 rounded p-2 flex items-center justify-between text-amber-300">
                <div class="truncate">
                  <span class="text-indigo-400 font-bold">{{ j.join_type.toUpperCase() }} JOIN</span>
                  [{{ j.target_table.database }}]..[{{ j.target_table.name }}] AS <strong class="text-white">{{ j.target_table.alias }}</strong>
                  <span class="text-slate-400 ml-2">ON {{ j.left_column.table_alias }}.{{ j.left_column.column_name }} = {{ j.right_column.table_alias }}.{{ j.right_column.column_name }}</span>
                </div>
                <button @click="removeJoin(idx)" class="text-slate-400 hover:text-red-400 ml-1">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <!-- 2. Select Columns Card -->
          <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Code2 class="w-4 h-4 text-emerald-400" />
                <span>Select Columns ({{ ast.select_columns.length }} selected)</span>
              </div>
              <div class="relative w-48">
                <Search class="w-3 h-3 text-slate-500 absolute left-2 top-2.5" />
                <input
                  v-model="columnSearch"
                  type="text"
                  placeholder="กรองคอลัมน์..."
                  class="w-full bg-slate-950 border border-slate-800 focus:border-indigo-500 text-xs pl-7 pr-2 py-1.5 rounded text-slate-200 outline-none"
                />
              </div>
            </div>

            <!-- Column Checklist & Dictionary Notes -->
            <div class="border border-slate-800 rounded-md overflow-hidden max-h-56 overflow-y-auto divide-y divide-slate-800">
              <div
                v-for="item in filteredColumns"
                :key="item.fullName"
                @click="toggleSelectColumn(item)"
                class="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-800/60 cursor-pointer transition"
                :class="{ 'bg-indigo-950/30': isColumnSelected(item.tableAlias, item.detail.name) }"
              >
                <div class="flex items-center gap-2.5 truncate">
                  <input
                    type="checkbox"
                    :checked="isColumnSelected(item.tableAlias, item.detail.name)"
                    class="rounded border-slate-600 bg-slate-950 text-indigo-600 focus:ring-0"
                    @click.stop="toggleSelectColumn(item)"
                  />
                  <div>
                    <span class="font-mono font-medium text-slate-200">{{ item.fullName }}</span>
                    <span class="text-slate-500 text-[10px] ml-1.5 font-mono">({{ item.detail.data_type }})</span>
                    <div v-if="item.note" class="text-[11px] text-amber-300 flex items-center gap-1 mt-0.5">
                      <BookOpen class="w-3 h-3 shrink-0" />
                      <span>{{ item.note.description }}</span>
                    </div>
                    <div class="text-[10px] text-slate-400 italic mt-0.5 truncate">
                      <span v-if="item.detail.sample_values.length > 0">
                        ตัวอย่าง: {{ item.detail.sample_values.map((s) => `"${s}"`).join(", ") }}
                      </span>
                      <span v-else class="text-slate-600">ตัวอย่าง: (ว่างทั้งหมด)</span>
                    </div>
                  </div>
                </div>

                <!-- Aggregate & Alias controls if selected -->
                <div
                  v-if="isColumnSelected(item.tableAlias, item.detail.name)"
                  @click.stop
                  class="flex items-center gap-2 ml-3 shrink-0"
                >
                  <select
                    v-model="getSelectedField(item.tableAlias, item.detail.name)!.aggregate"
                    @change="syncGroupBy(); refreshExportCode()"
                    class="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-300"
                  >
                    <option value="None">Raw</option>
                    <option value="Sum">SUM</option>
                    <option value="Count">COUNT</option>
                    <option value="Avg">AVG</option>
                    <option value="Max">MAX</option>
                    <option value="Min">MIN</option>
                  </select>
                  <input
                    v-model="getSelectedField(item.tableAlias, item.detail.name)!.output_alias"
                    @input="refreshExportCode()"
                    type="text"
                    placeholder="AS Alias..."
                    class="w-28 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-[11px] text-indigo-300 placeholder-slate-600 font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- 3. WHERE Conditions Card -->
          <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Eye class="w-4 h-4 text-amber-400" />
                <span>Filter Conditions (WHERE)</span>
              </div>
              <button
                @click="addWhereCondition"
                class="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded border border-slate-700"
              >
                <Plus class="w-3.5 h-3.5" /> Add Filter
              </button>
            </div>

            <div v-if="ast.where_conditions.length === 0" class="text-xs text-slate-500 italic py-1">ไม่มีเงื่อนไขกรองข้อมูล</div>
            <div v-else class="space-y-2">
              <div v-for="(cond, idx) in ast.where_conditions" :key="idx" class="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded p-2">
                <select
                  :value="`${cond.column.table_alias}.${cond.column.column_name}`"
                  @change="(e: any) => { const [a, c] = e.target.value.split('.'); cond.column = { table_alias: a, column_name: c }; refreshExportCode(); }"
                  class="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-200 text-xs"
                >
                  <option v-for="c in allAvailableColumns" :key="c.fullName" :value="c.fullName">{{ c.fullName }}</option>
                </select>

                <select v-model="cond.operator" @change="refreshExportCode()" class="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-amber-400 text-xs">
                  <option value="Eq">=</option>
                  <option value="NotEq">&lt;&gt;</option>
                  <option value="Gt">&gt;</option>
                  <option value="Gte">&gt;=</option>
                  <option value="Lt">&lt;</option>
                  <option value="Lte">&lt;=</option>
                  <option value="Like">LIKE</option>
                  <option value="In">IN</option>
                  <option value="IsNull">IS NULL</option>
                  <option value="IsNotNull">IS NOT NULL</option>
                </select>

                <button
                  @click="toggleWhereMode(idx)"
                  class="px-2 py-1 rounded text-[10px] font-bold border shrink-0"
                  :class="typeof cond.value === 'object' && 'Parameter' in cond.value ? 'bg-indigo-950 text-indigo-300 border-indigo-700' : 'bg-slate-800 text-slate-400 border-slate-700'"
                >
                  {{ typeof cond.value === 'object' && 'Parameter' in cond.value ? '@Param' : 'Static' }}
                </button>

                <input
                  v-if="typeof cond.value === 'object' && 'Parameter' in cond.value"
                  v-model="cond.value.Parameter.param_name"
                  @input="refreshExportCode()"
                  placeholder="ParamName"
                  class="w-28 bg-slate-950 border border-indigo-800/70 rounded px-2 py-1 font-mono text-indigo-300 text-xs"
                />
                <input
                  v-else-if="typeof cond.value === 'object' && 'Static' in cond.value"
                  v-model="cond.value.Static.raw_value"
                  @input="refreshExportCode()"
                  placeholder="Value"
                  class="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-200 text-xs"
                />

                <button @click="ast.where_conditions.splice(idx, 1); refreshExportCode()" class="text-slate-500 hover:text-red-400">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <!-- 4. ORDER BY Card -->
          <div class="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-2">
                <Link2 class="w-4 h-4 text-purple-400" />
                <span>Sort Order (ORDER BY)</span>
              </div>
              <button
                @click="addOrderBy"
                class="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-1 rounded border border-slate-700"
              >
                <Plus class="w-3.5 h-3.5" /> Add Sort
              </button>
            </div>

            <div v-if="ast.order_by.length === 0" class="text-xs text-slate-500 italic py-1">ไม่ได้กำหนดการจัดเรียง</div>
            <div v-else class="space-y-2">
              <div v-for="(ord, idx) in ast.order_by" :key="idx" class="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded p-2">
                <select
                  :value="`${ord.column.table_alias}.${ord.column.column_name}`"
                  @change="(e: any) => { const [a, c] = e.target.value.split('.'); ord.column = { table_alias: a, column_name: c }; refreshExportCode(); }"
                  class="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-slate-200 text-xs"
                >
                  <option v-for="c in allAvailableColumns" :key="c.fullName" :value="c.fullName">{{ c.fullName }}</option>
                </select>

                <select v-model="ord.direction" @change="refreshExportCode()" class="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-amber-400 text-xs">
                  <option value="Desc">DESC (ล่าสุดก่อน)</option>
                  <option value="Asc">ASC (น้อยไปมาก)</option>
                </select>

                <button @click="ast.order_by.splice(idx, 1); refreshExportCode()" class="text-slate-500 hover:text-red-400">
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ========================================== -->
      <!-- ZONE 3: Bottom (Live Preview & Export)     -->
      <!-- ========================================== -->
      <div class="h-64 bg-slate-900 border-t border-slate-800 flex flex-col shrink-0">
        <!-- Tab Navigation Bar -->
        <div class="flex items-center justify-between bg-slate-950/80 px-4 py-2 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <button
              @click="bottomTab = 'preview'"
              class="flex items-center gap-1.5 text-xs px-3 py-1 rounded-md transition"
              :class="bottomTab === 'preview' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'"
            >
              <Eye class="w-3.5 h-3.5" /> Live Data Preview
            </button>
            <button
              @click="bottomTab = 'export'; refreshExportCode()"
              class="flex items-center gap-1.5 text-xs px-3 py-1 rounded-md transition"
              :class="bottomTab === 'export' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'"
            >
              <Code2 class="w-3.5 h-3.5" /> Export Code
            </button>
          </div>

          <!-- Run Preview Action Button -->
          <button
            v-if="ast"
            @click="runPreview"
            :disabled="isRunningPreview"
            class="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-3.5 py-1 rounded-md shadow transition"
          >
            <Play class="w-3.5 h-3.5 fill-current" />
            {{ isRunningPreview ? "Running..." : `Run Preview (TOP ${config.default_preview_limit})` }}
          </button>
        </div>

        <!-- Tab Panels -->
        <div class="flex-1 overflow-auto p-4">
          <!-- Panel 1: Live Data Grid -->
          <div v-if="bottomTab === 'preview'" class="h-full">
            <div v-if="!previewData" class="h-full flex items-center justify-center text-xs text-slate-500 italic">
              กดปุ่ม Run Preview เพื่อทดสอบดึงข้อมูลจริงจาก SQL Server
            </div>
            <div v-else-if="previewData.rows.length === 0" class="h-full flex items-center justify-center text-xs text-amber-400">
              ⚠️ ไม่พบข้อมูลที่ตรงกับเงื่อนไข (0 แถว)
            </div>
            <div v-else class="overflow-auto border border-slate-800 rounded-md">
              <table class="w-max min-w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr class="bg-slate-950 text-slate-300 border-b border-slate-800">
                    <th v-for="h in previewData.headers" :key="h" class="p-2 font-semibold whitespace-nowrap" :title="h">{{ h }}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60">
                  <tr v-for="(row, rIdx) in previewData.rows" :key="rIdx" class="hover:bg-slate-800/40">
                    <td
                      v-for="(val, cIdx) in row"
                      :key="cIdx"
                      class="preview-cell p-2 whitespace-nowrap"
                      :title="val"
                      :class="val === 'NULL' ? 'text-slate-600 italic' : 'text-slate-300'"
                    >
                      {{ val }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Panel 2: Multi-Target Code Export -->
          <div v-if="bottomTab === 'export'" class="h-full flex flex-col gap-2">
            <!-- Language Target Switcher -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <button
                  v-for="opt in [
                    { id: 'csharp_bundle', label: 'C# Full Bundle' },
                    { id: 'csharp', label: 'C# Query + Params' },
                    { id: 'pure_sql', label: 'Pure T-SQL' },
                    { id: 'typescript', label: 'TypeScript' },
                  ]"
                  :key="opt.id"
                  @click="exportTarget = opt.id as any; refreshExportCode()"
                  class="px-2.5 py-1 rounded text-[11px] border transition"
                  :class="exportTarget === opt.id ? 'bg-indigo-600 text-white border-indigo-500 font-medium' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'"
                >
                  {{ opt.label }}
                </button>
              </div>

              <button
                @click="copyCodeToClipboard"
                class="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded border border-slate-700 transition"
              >
                <component :is="copied ? Check : Copy" class="w-3.5 h-3.5" />
                {{ copied ? "Copied!" : "Copy Code" }}
              </button>
            </div>

            <!-- Code Display Area -->
            <pre class="flex-1 bg-slate-950 border border-slate-800 p-3 rounded-md font-mono text-xs text-indigo-200 overflow-auto"><code>{{ exportedCode || "// เลือกตารางหลักและคอลัมน์เพื่อสร้างโค้ดอัตโนมัติ" }}</code></pre>
          </div>
        </div>
      </div>
    </main>

    <!-- ========================================== -->
    <!-- MODAL 1: Database Connection Settings      -->
    <!-- ========================================== -->
    <div v-if="showConnModal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 w-full max-w-md rounded-xl shadow-2xl overflow-hidden p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <div class="flex items-center gap-2">
            <Database class="w-5 h-5 text-indigo-400" />
            <h3 class="text-sm font-bold text-slate-200">SQL Server Connection</h3>
          </div>
          <button v-if="isConnected" @click="showConnModal = false" class="text-slate-400 hover:text-white">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="text-slate-400 block mb-1">Authentication Mode</label>
            <select v-model="config.auth_mode" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200">
              <option value="SqlServer">SQL Server Authentication</option>
              <option value="Windows">Windows Authentication (Integrated)</option>
            </select>
          </div>

          <div>
            <label class="text-slate-400 block mb-1">Server Host / Instance</label>
            <input v-model="config.host" type="text" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200" />
          </div>

          <div>
            <label class="text-slate-400 block mb-1">Port</label>
            <input v-model.number="config.port" type="number" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200" />
          </div>

          <template v-if="config.auth_mode === 'SqlServer'">
            <div>
              <label class="text-slate-400 block mb-1">Username</label>
              <input v-model="config.username" type="text" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200" />
            </div>
            <div>
              <label class="text-slate-400 block mb-1">Password</label>
              <input v-model="config.password" type="password" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200" />
            </div>
          </template>

          <div>
            <label class="text-slate-400 block mb-1">Default Database (เว้นว่างได้)</label>
            <input v-model="config.database" type="text" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200" />
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <button v-if="isConnected" @click="showConnModal = false" class="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancel</button>
          <button
            @click="handleConnect"
            :disabled="isConnecting"
            class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-md transition"
          >
            {{ isConnecting ? "Connecting..." : "Connect & Save" }}
          </button>
        </div>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- MODAL 2: Add Cross-Database JOIN           -->
    <!-- ========================================== -->
    <div v-if="showJoinModal" class="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-xl shadow-2xl overflow-hidden p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 class="text-sm font-bold text-slate-200">Add Table Relationship (Cross-Database JOIN)</h3>
          <button @click="showJoinModal = false" class="text-slate-400 hover:text-white">✕</button>
        </div>

        <div class="space-y-3 text-xs">
          <!-- Target Database -->
          <div>
            <label class="text-slate-400 block mb-1">Target Database</label>
            <select :value="joinTargetDb" @change="(e: any) => onChangeJoinDb(e.target.value)" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200">
              <option v-for="db in databases" :key="db" :value="db">{{ db }}</option>
            </select>
          </div>

          <!-- Target Table -->
          <div>
            <label class="text-slate-400 block mb-1">Target Table</label>
            <select
              :value="joinTargetTable?.name || ''"
              @change="(e: any) => { const found = joinTargetTables.find(t => t.name === e.target.value); if(found) onSelectJoinTargetTable(found); }"
              class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200"
            >
              <option value="">-- เลือกตาราง --</option>
              <option v-for="t in joinTargetTables" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
          </div>

          <!-- Join Type & Alias -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-slate-400 block mb-1">Join Type</label>
              <select v-model="joinType" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200">
                <option value="Left">LEFT JOIN</option>
                <option value="Inner">INNER JOIN</option>
              </select>
            </div>
            <div>
              <label class="text-slate-400 block mb-1">Alias</label>
              <input v-model="joinAlias" type="text" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2.5 py-2 text-slate-200 font-mono" />
            </div>
          </div>

          <!-- ON Conditions -->
          <div class="grid grid-cols-2 gap-3 pt-2">
            <div>
              <label class="text-slate-400 block mb-1">1. คอลัมน์ฝั่งตารางที่มีอยู่ (ON Left)</label>
              <select v-model="joinLeftCol" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-2 text-slate-200 font-mono text-[11px]">
                <option v-for="c in allAvailableColumns" :key="c.fullName" :value="c.fullName">
                  {{ c.fullName }} ({{ c.detail.data_type }}) -> {{ c.detail.sample_values[0] || 'NULL' }}
                </option>
              </select>
            </div>

            <div>
              <label class="text-slate-400 block mb-1">2. คอลัมน์ฝั่ง Target (ON Right)</label>
              <select v-model="joinRightCol" class="w-full bg-slate-950 border border-slate-700 rounded-md px-2 py-2 text-slate-200 font-mono text-[11px]">
                <option v-for="c in joinTargetCols" :key="c.name" :value="c.name">
                  {{ joinAlias }}.{{ c.name }} ({{ c.data_type }}) -> {{ c.sample_values[0] || 'NULL' }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-slate-800">
          <button @click="showJoinModal = false" class="px-3 py-1.5 text-xs text-slate-400 hover:text-white">Cancel</button>
          <button
            @click="confirmAddJoin"
            :disabled="!joinTargetTable || !joinLeftCol || !joinRightCol"
            class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold px-4 py-2 rounded-md transition"
          >
            Add Join
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: #020617;
}
::-webkit-scrollbar-thumb {
  background: #1e293b;
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #334155;
}
</style>