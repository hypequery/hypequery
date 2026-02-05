export class JoinRelationships {
    paths = new Map();
    /**
     * Define a single join relationship
     */
    define(name, path) {
        if (this.paths.has(name)) {
            throw new Error(`Join relationship '${name}' is already defined`);
        }
        this.paths.set(name, path);
    }
    /**
     * Define a chain of join relationships
     */
    defineChain(name, paths) {
        if (this.paths.has(name)) {
            throw new Error(`Join chain '${name}' is already defined`);
        }
        if (paths.length === 0) {
            throw new Error('Join chain must contain at least one path');
        }
        this.paths.set(name, paths);
    }
    /**
     * Get a join relationship by name
     */
    get(name) {
        return this.paths.get(name);
    }
    /**
     * Check if a join relationship exists
     */
    has(name) {
        return this.paths.has(name);
    }
    /**
     * Remove a join relationship
     */
    remove(name) {
        return this.paths.delete(name);
    }
    /**
     * Clear all join relationships
     */
    clear() {
        this.paths.clear();
    }
    /**
     * Get all defined relationship names
     */
    getDefinedRelationships() {
        return Array.from(this.paths.keys());
    }
}
