export class NoopCacheProvider {
    async get(_key) {
        return null;
    }
    async set(_key, _entry) {
        return;
    }
    async delete(_key) {
        return;
    }
}
