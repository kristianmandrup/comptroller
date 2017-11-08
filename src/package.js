const path = require('path');
const glob = require('./glob');
const fs = require('./fs');
const builtins = require('builtin-modules');
const detective = require('@zdychacek/detective');
const sortPackageJson = require('sort-package-json');
const Patch = require('./patch');

/**
 * This is the package class. It serves as encapsulation for individual
 * packages, as a means of querying for package info, and as an outlet for
 * changes to a package.
 */
module.exports = class Package
{
  /**
   * Creates a new package instance. It can accept it's configuration either
   * through the package.json file or through the constructor arguments.
   * @param {object} opts - The package options.
   * @param {string} opts.root - The root directory of the package.
   * @param {object} [opts.packageJson = fs.readJson('root package.json')] - The
   * package's package.json. If not specified, it's read from the root
   * directory.
   * @param {object} [opts.config = opts.packageJson.comptroller || {}] - The
   * Comptroller configurations options.
   * @param {glob} [opts.config.source = '⚹⚹/⚹.js'] - A glob that selects
   * the packages source files.
   * @param {glob[]} [opts.config.ignore = ['⚹⚹/node_modules/⚹⚹']] - An array
   * of globs to pass into {@link glob}'s `ignore` option when searching for
   * source files.
   * @param {string[]} [opts.config.exclude = builtins] - An array of package
   * names to ignore in all operations. Defaults to {@link builtin-modules}.
   * @param {string[]} [opts.config.inherits = []] - An array of field names to
   * inherit from the parent package.json. This is useful for values that
   * remain the same across all packages.
   * @param {object} [opts.config.detective = {}] - The options to pass through
   * to <a href="https://npmjs.com/package/@zdychacek/detective">detective</a>.
   * @param {boolean} [opts.config.prune = false] - Whether or not unused
   * dependencies should be pruned from the package.json.
   */
  constructor ({
    root,
    packageJson = fs.readJsonSync(path.resolve(root, 'package.json')),
    config = {},
    _config = packageJson.comptroller || {},
    source = _config.source || config.source || '**/*.js',
    ignore = _config.ignore || config.ignore || ['**/node_modules/**'],
    exclude = _config.exclude || config.exclude || builtins,
    inherits = _config.inherits || config.inherits || [],
    detective = _config.detective || config.detective || {},
    prune = _config.prune || config.prune || false,
  })
  {
    /** @type {string} */
    this._root = root;

    /** @type {object} */
    this._packageJson = packageJson;

    /** @type {glob} */
    this._source = source;

    /** @type {glob[]} */
    this._ignore = ignore;

    /** @type {string[]} */
    this._exclude = exclude;

    /** @type {string[]} */
    this._inherits = inherits;

    /** @type {object} */
    this._detective = detective;

    /** @type {boolean} */
    this._prune = prune;
  }

  /**
   * The package's root directory.
   * @type {string}
   */
  get root () {return this._root}

  /**
   * An object representing the package's package.json.
   * @type {object}
   */
  get packageJson () {return this._packageJson}

  /**
   * An object representing the package's dependencies.
   * @type {object}
   */
  get dependencies () {return this.packageJson.dependencies || (this.packageJson.dependencies = {})}

  /**
   * A glob that matches the package's source files
   * @type {glob}
   */
  get source () {return this._source}

  /**
   * An array of globs that match files not to be included with the package's
   * source files.
   * @type {glob[]}
   */
  get ignore () {return this._ignore}

  /**
   * An array of package names to ignore in all operations.
   * @type {string[]}
   */
  get exclude () {return this._exclude}

  /**
   * An array of field names the package should inherit from it's parent
   * package.json.
   * @type {string[]}
   */
  get inherits () {return this._inherits}

  /**
   * The options to pass through to <a href="https://npmjs.com/package/@zdychacek/detective">detective</a>.
   * @type {object}
   */
  get detective () {return this._detective}

  /**
   * Whether or not unused dependencies should be pruned from the package.json.
   * @type {boolean}
   */
  get prune () {return this._prune}

  /**
   * Writes {@link Package#packageJson} to it's respective package.json file.
   */
  async writePackageJson ()
  {
    const packageJson = sortPackageJson(this.packageJson);
    const json = JSON.stringify(packageJson, null, 2);
    await fs.writeFilePlease(path.resolve(this.root, 'package.json'), json);
  }

  /**
   * Takes a dependency name and resolves it to the actual dependency name,
   * stripping any subdirectories from the dependency name (retaining @org
   * style dependencies). It also excludes dependencies with relative paths (./
   * or ../ style) and any dependencies listed in {@link Package#exclude}
   * @param {string} dependency - The dependency to resolve
   * @return {string | boolean} - The resolved dependency name, or false if the
   * the dependency is excluded.
   */
  resolveDependency (dependency)
  {
    if (dependency.charAt(0) == '.') return false;
    if (this.exclude.indexOf(dependency) >= 0) return false;
    const split = dependency.split('/');
    return split[0].charAt(0) == '@' ? split[0] + '/' + split[1] : split[0];
  }

  /**
   * Analyzes the package's source files and returns all of the invoked
   * dependencies mapped to the files invoking them.
   * @return {Map<string, object>} - A map with the dependency names as keys
   * and the dependency metadata as values.
   */
  async analyzeSourceDependencies ()
  {
    const files = await glob.please(path.resolve(this.root, this.source), {
      ignore: this.ignore,
      nodir: true,
    });
    const deps = {};
    await Promise.all(files.map(async (file) => {
      const src = await fs.readFilePlease(file);
      const dependencies = detective(src, this.detective);
      const relFile = path.relative(this.root, file);
      for (let dep of dependencies) {
        if (dep = this.resolveDependency(dep)) {
          deps[dep] = deps[dep] || {files: []};
          deps[dep].files.push(relFile);
        }
      }
    }));
    return deps;
  }

  /**
   * Compares a dependency object (as returned from {@link Package#analyzeSourceDependencies})
   * with the dependencies listed in {@link Package@packageJson} and returns an
   * array of patches.
   * @param {object} dependencies - The dependencies to generate a patch for.
   * @return {Patch[]} - The patches that will make {@link Package#packageJson} match the inputted dependencies
   */
  generateDependencyPatches (dependencies)
  {
    const patches = [];
    const usedDeps = {};

    for (let dep in dependencies)
    {
      let {files} = dependencies[dep];
      usedDeps[dep] = true;
      if (!(dep in this.dependencies)) {
        patches.push(new Patch(Patch.ADD, {name: dep, files}));
      }
      else {
        patches.push(new Patch(Patch.UPDATE, {name: dep, files}));
      }
    }

    for (let dep in this.dependencies) {
      if (!usedDeps[dep]) {
        patches.push(new Patch(Patch.REMOVE, {name: dep}))
      }
    }

    return patches;
  }

  /**
   * Generates the patches that will satisfy {@link Package#inherits}
   * @return {Patch[]} - The patches that will update {@link Package#packageJson} with the inherited fields.
   */
  generateInheritPatches ()
  {
    return this.inherits.map((name) => new Patch(Patch.INHERIT, {name}));
  }

  /**
   * Applies a given patch to {@link Package#packageJson}.
   * @param {Patch} patch - The patch to apply,
   */
  applyPatch (patch)
  {
    if (patch.disabled) return;

    switch (patch.type) {
      case Patch.ADD:
      case Patch.UPDATE:
        if (typeof patch.value !== 'undefined') {
          this.dependencies[patch.name] = patch.value;
        }
        break;
      case Patch.REMOVE:
        delete this.dependencies[patch.name];
        break;
      case Patch.INHERIT:
        if (typeof patch.value !== 'undefined') {
          this.packageJson[patch.name] = patch.value;
        }
      default:
        break;
    }
  }
}
