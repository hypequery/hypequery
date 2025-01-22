/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_CLICKHOUSE_HOST: string;
    readonly VITE_CLICKHOUSE_USER: string;
    readonly VITE_CLICKHOUSE_PASSWORD: string;
    readonly VITE_CLICKHOUSE_DATABASE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
} 