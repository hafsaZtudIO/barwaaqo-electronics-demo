import { PGlite } from "@electric-sql/pglite";
import migrations from "shop-migrations";
import { createSampleSchema, seedSampleShop, captureSnapshot, restoreSnapshot, snapshotTables, sampleOwner } from "./sample-shop.js";
import { AccessError, ShopError } from "./ports.js";

const storageKey = "barwaaqo-full-workspace-v2";
const actorKey = "barwaaqo-full-workspace-actor";
let database;
let revision;
let modules;
let queue = Promise.resolve();

export function currentSubject() {
    return sessionStorage.getItem(actorKey) ?? sampleOwner;
}

export function setSubject(subject) {
    sessionStorage.setItem(actorKey, subject);
}

async function wasmFiles() {
    modules ??= Promise.all([
        fetch(new URL("./pglite.wasm", import.meta.url)).then(response => response.arrayBuffer()).then(WebAssembly.compile),
        fetch(new URL("./initdb.wasm", import.meta.url)).then(response => response.arrayBuffer()).then(WebAssembly.compile),
        fetch(new URL("./pglite.data", import.meta.url)).then(response => {
            if (!response.ok) throw new Error("Could not download the sample workspace database.");
            return response.blob();
        }),
    ]);
    const [pgliteWasmModule, initdbWasmModule, fsBundle] = await modules;
    return { pgliteWasmModule, initdbWasmModule, fsBundle };
}

async function openDatabase() {
    const saved = localStorage.getItem(storageKey);
    const snapshot = saved ? JSON.parse(saved) : null;
    if (database && (snapshot?.revision ?? null) === revision) return database;
    if (database) await database.close();
    database = await PGlite.create(await wasmFiles());
    await createSampleSchema(database, migrations);
    if (snapshot) await restoreSnapshot(database, snapshot);
    else {
        await seedSampleShop(database);
        const initial = await captureSnapshot(database);
        localStorage.setItem(storageKey, JSON.stringify(initial));
        revision = initial.revision;
        return database;
    }
    revision = snapshot.revision;
    return database;
}

export function withDatabase(callback, { write = false } = {}) {
    async function run() {
        async function locked() {
            const db = await openDatabase();
            try {
                if (!write) return await callback(db);
                return await db.transaction(async transaction => {
                    const result = await callback(transaction);
                    await transaction.exec("set constraints all immediate");
                    const snapshot = await captureSnapshot(transaction);
                    localStorage.setItem(storageKey, JSON.stringify(snapshot));
                    revision = snapshot.revision;
                    return result;
                });
            } catch (error) {
                if (error instanceof AccessError || error instanceof ShopError) throw error;
                throw new ShopError(error.message || "The sample workspace could not complete this operation.");
            }
        }
        return navigator.locks ? navigator.locks.request(storageKey, locked) : locked();
    }
    const result = queue.then(run);
    queue = result.catch(() => {});
    return result;
}

export async function resetWorkspace() {
    await withDatabase(async db => {
        await db.exec("truncate " + snapshotTables.map(table => "shop." + table).join(",") + " cascade");
        // Recreate the starter categories and settings after clearing the saved records.
        await db.exec(`insert into shop.shop_settings default values;
            insert into shop.categories(name) values ('Smartphones'),('Laptops'),('Desktop Computers'),
            ('Monitors'),('Televisions'),('Printers'),('Headphones'),('Chargers'),('Computer Accessories'),('Other Electronics');`);
        await seedSampleShop(db);
    }, { write: true });
    setSubject(sampleOwner);
    for (const key of Object.keys(localStorage)) {
        if (key.startsWith("barwaaqo-demo-photo-")) localStorage.removeItem(key);
    }
}

export async function rpc(db, name, parameters) {
    const placeholders = parameters.map((_, index) => "$" + (index + 1)).join(",");
    return (await db.query(`select public.${name}(${placeholders}) as value`, parameters)).rows[0]?.value;
}
