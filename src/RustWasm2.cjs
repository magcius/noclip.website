
const { Compilation, Compiler } = require("webpack");
const { spawn, SpawnOptions } = require("child_process");
const { mkdirSync, existsSync, readdirSync } = require("fs");
const path = require("path");
const wasm_opt = require("./vendor/binaryen/wasm-opt");

function* findAllWithExtension(dir, extension) {
    const items = readdirSync(dir, { withFileTypes: true });
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.isDirectory() && item.name[0] !== '.')
            yield* findAllWithExtension(path.join(dir, item.name), extension);
        else if (item.isFile() && path.extname(item.name) === extension)
            yield path.join(dir, item.name);
    }
}

class Process {
    /**
     * @param {string} cmd 
     * @param {string[]} args 
     * @param {SpawnOptions} options 
     */
    constructor(cmd, args, options) {
        this._cmd = cmd;
        this._args = args;
        this._options = options;
    }

    abort() {
        this._process.kill();
        this._process = null;
    }

    run() {
        this._process = spawn(this._cmd, this._args, this._options);

        return new Promise((resolve, reject) => {
            this._process.on('exit', (code) => {
                if (this._process !== null && code === 0)
                    resolve(code);
                else
                    reject(code);
            });
        });
    }
}

class Build {
    /**
     * @param {string} crateName
     * @param {string} crateDir
     * @param {string} outDir
     */
    constructor(crateName, crateDir, outDir) {
        this._crateName = crateName;
        this._crateDir = crateDir;
        this._outDir = outDir;
    }

    /**
     * @param {string} cmd 
     * @param {string[]} args 
     * @param {SpawnOptions} options 
     */
    async runProcess(cmd, args, options) {
        this._currentBlocker = new Process(cmd, args, options);
        await this._currentBlocker.run();
        this._currentBlocker = null;
    }

    async run() {
        mkdirSync(this._outDir, { recursive: true });

        await this.runProcess('cargo', ['build',
            '--release', '--lib', '--target', 'wasm32-unknown-unknown',
        ], { cwd: this._crateDir, stdio: 'inherit' });

        const rustcOut = path.join(this._crateDir, 'target', 'wasm32-unknown-unknown', 'release', `${this._crateName}.wasm`);
        if (!existsSync(rustcOut))
            throw new Error(`Could not find output path ${rustcOut}`);

        await this.runProcess('wasm-bindgen', [
            '--target', 'bundler', '--out-name', 'index',
            '--out-dir', this._outDir, '--typescript', rustcOut,
        ]);

        // TODO(jstpierre): Generate a package.json module? Doesn't seem to be needed yet, actually...

        // TODO(jstpierre): Run wasm-opt?
    }

    abort() {
        if (this._currentBlocker !== null)
            this._currentBlocker.abort();
    }
}

exports.RustWasm2 = class RustWasm2 {
    /**
     * 
     * @param {{ crateName: string, crateDir: string, outDir?: string }} options
     */
    constructor(options) {
        this.crateName = options.crateName;
        this.crateDir = options.crateDir;
        this.outDir = options.outDir || path.join(this.crateDir, `pkg`);

        this._currentBuild = null;
    }

    async _compile() {
        console.time("Rust build");
        this._currentBuild = new Build(this.crateName, this.crateDir, this.outDir);
        try {
            await this._currentBuild.run();
        } catch(e) {
            console.error(`Error in build: ${e}`);
            console.error(e.stack);
        }
        this._currentBuild = null;
        console.timeEnd("Rust build");
    }

    /**
     * @param {Compiler} compiler 
     */
    apply(compiler) {
        compiler.hooks.thisCompilation.tap({ name: "RustWasm2" },
            /**
             * @param {Compilation} compilation 
             */
            (compilation) => {
                // First, abort any existing compilation.
                if (this._currentBuild !== null)
                    this._currentBuild.abort();

                // Launch the async build
                this._compile();

                compilation.fileDependencies.addAll(findAllWithExtension(this.crateDir, '.rs'));
            },
        );
    }
};
