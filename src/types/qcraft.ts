export type AuthMode = "SqlServer" | "Windows";

export interface GlobalFilterRule {
  column_name: string;
  operator: string;
  value: string;
  is_numeric: boolean;
}

export interface AppConfig {
  host: string;
  port: number;
  database: string;
  auth_mode: AuthMode;
  username: string | null;
  password: string | null;
  trust_cert: boolean;
  default_preview_limit: number;
  global_rules: GlobalFilterRule[];
}

export interface ColumnNote {
  description: string;
  suggested_alias: string | null;
}

export interface SchemaDictionary {
  tables: Record<string, Record<string, ColumnNote>>;
}

export interface TableInfo {
  schema: string;
  name: string;
}

export interface ColumnDetail {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  sample_values: string[];
}

export interface ForeignKeyRelation {
  constraint_name: string;
  from_schema: string;
  from_table: string;
  from_column: string;
  to_schema: string;
  to_table: string;
  to_column: string;
}

export interface TableRef {
  database: string;
  schema: string;
  name: string;
  alias: string;
}

export interface ColumnRef {
  table_alias: string;
  column_name: string;
}

export type JoinType = "Inner" | "Left" | "Right";

export interface JoinClause {
  join_type: JoinType;
  target_table: TableRef;
  left_column: ColumnRef;
  right_column: ColumnRef;
}

export type AggregateFunc = "None" | "Count" | "Sum" | "Avg" | "Min" | "Max";

export interface SelectField {
  column: ColumnRef;
  output_alias: string | null;
  aggregate: AggregateFunc;
  sql_data_type: string;
}

export type CompareOperator =
  | "Eq"
  | "NotEq"
  | "Gt"
  | "Gte"
  | "Lt"
  | "Lte"
  | "Like"
  | "In"
  | "IsNull"
  | "IsNotNull";

export type FilterValue =
  | { Static: { raw_value: string; is_numeric: boolean } }

  | { Parameter: { param_name: string; sample_value: string | null; is_numeric: boolean } }
  | "None";

export interface WhereCondition {
  column: ColumnRef;
  operator: CompareOperator;
  value: FilterValue;
  is_auto_rule: boolean;
}

export type SortDirection = "Asc" | "Desc";

export interface OrderField {
  column: ColumnRef;
  direction: SortDirection;
}

export interface QueryAst {
  main_table: TableRef;
  joins: JoinClause[];
  select_columns: SelectField[];
  where_conditions: WhereCondition[];
  group_by: ColumnRef[];
  order_by: OrderField[];
  top_limit: number | null;
}

export interface PreviewResult {
  executed_sql: string;
  headers: string[];
  rows: string[][];
}
