require('./settings')
const path = require('../../src/path');
const {
  expect
} = require('chai');
const {
  makepkg,
  rempkg,
  fileStructure
} = require('./makepkg');
const fs = require('../../src/fs');
const Patch = require('../../src/patch');
const Package = require('../../src/package');

describe('Package: ES6', function () {
  beforeEach(async function () {
    this.packageDir = path.resolve(__dirname, 'test-package')
    await rempkg(this.packageDir);
    await makepkg(this.packageDir, fileStructure);
    this.package = new Package({
      root: this.packageDir
    });
  });

  afterEach(async function () {
    delete this.package;
    await rempkg(this.packageDir);
    delete this.packageDir;
  });

  describe('#resolveDependency()', function () {
    it('should return false for relative dependencies', function () {
      expect(this.package.resolveDependency('../name')).to.be.false;
      expect(this.package.resolveDependency('./name')).to.be.false;
    });

    it('should return false for excluded dependencies', function () {
      expect(this.package.resolveDependency('excluded-dependency')).to.be.false;
    });

    it('should return static non-relative dependency name', function () {
      expect(this.package.resolveDependency('dependency')).to.equal('dependency');
      expect(this.package.resolveDependency('dependency/module')).to.equal('dependency');
      expect(this.package.resolveDependency('@org/dependency')).to.equal('@org/dependency');
      expect(this.package.resolveDependency('@org/dependency/module')).to.equal('@org/dependency');
    });
  });

  describe('#analyzeSourceDependencies()', function () {
    it('should return correct dependencies', async function () {
      const dependencies = {
        'dependency-1': {
          files: ['index.mjs', 'packages/package-1/index.mjs', 'packages/package-2/index.mjs']
        },
        'dependency-2': {
          files: ['index.mjs', 'packages/package-2/index.mjs']
        },
        'http': {
          files: ['index.mjs']
        },
        'not-a-package': {
          files: ['index.mjs']
        },
        'doesnt-exist': {
          files: ['packages/package-1/index.mjs']
        },
        'events': {
          files: ['packages/package-1/index.mjs']
        },
        '@test/package-1': {
          files: ['packages/package-2/index.mjs']
        },
        'dev-dependency-1': {
          files: ['index.mjs', 'test.mjs']
        },
      };
      const analyzed = await this.package.analyzeSourceDependencies();
      const keys = [
        'dependency-1',
        'dependency-2',
        'http',
        'not-a-package',
        'doesnt-exist',
        'events',
        '@test/package-1',
        'dev-dependency-1',
        'dev-dependency-3'
      ]

      expect(analyzed).to.have.all.keys(keys);

      expect(analyzed['dependency-1']).to.have.key('files');
      expect(analyzed['dependency-1']['files']).to.include('index.mjs', 'packages/package-1/index.mjs', 'packages/package-2/index.mjs');

      expect(analyzed['dependency-2']).to.have.key('files');
      expect(analyzed['dependency-2']['files']).to.include('index.mjs', 'packages/package-2/index.mjs');

      expect(analyzed['http']).to.have.key('files');
      expect(analyzed['http']['files']).to.include('index.mjs');

      expect(analyzed['not-a-package']).to.have.key('files');
      expect(analyzed['not-a-package']['files']).to.include('index.mjs');

      expect(analyzed['doesnt-exist']).to.have.key('files');
      expect(analyzed['doesnt-exist']['files']).to.include('packages/package-1/index.mjs');

      expect(analyzed['events']).to.have.key('files');
      expect(analyzed['events']['files']).to.include('packages/package-1/index.mjs');

      expect(analyzed['@test/package-1']).to.have.key('files');
      expect(analyzed['@test/package-1']['files']).to.include('packages/package-2/index.mjs');
    });
  });

  describe('#generateDependencyPatches(dependencies)', function () {
    it('should generate update patches for used dependences', function () {
      const newDeps = {
        'dependency-1': {
          files: ['file-1.mjs']
        },
        'dependency-2': {
          files: ['file-2.mjs']
        }
      };
      const patches = this.package.generateDependencyPatches(newDeps);

      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(3);

      expect(patches[0]).to.be.an.instanceof(Patch);
      expect(patches[0].type).to.equal(Patch.UPDATE);
      expect(patches[0].name).to.equal('dependency-1');
      expect(patches[0].files).to.deep.equal(['file-1.mjs']);

      expect(patches[1]).to.be.an.instanceof(Patch);
      expect(patches[1].type).to.equal(Patch.UPDATE);
      expect(patches[1].name).to.equal('dependency-2');
      expect(patches[1].files).to.deep.equal(['file-2.mjs']);
    });

    it('should generate update patches for used devDependences', function () {
      const newDeps = {
        'dev-dependency-1': {
          files: ['test.mjs']
        },
        'dev-dependency-2': {
          files: ['test.mjs']
        }
      };
      const patches = this.package.generateDependencyPatches(newDeps);

      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(5);

      expect(patches[0]).to.be.an.instanceof(Patch);
      expect(patches[0].type).to.equal(Patch.UPDATE);
      expect(patches[0].name).to.equal('dev-dependency-1');
      expect(patches[0].files).to.deep.equal(['test.mjs']);

      expect(patches[1]).to.be.an.instanceof(Patch);
      expect(patches[1].type).to.equal(Patch.UPDATE);
      expect(patches[1].name).to.equal('dev-dependency-2');
      expect(patches[1].files).to.deep.equal(['test.mjs']);
    });

    it('should generate add patches for new dependencies', function () {
      const newDeps = {
        'dependency-1': {
          files: ['file-1.mjs']
        },
        'dependency-2': {
          files: ['file-2.mjs']
        },
        'dependency-3': {
          files: ['file-3.mjs']
        }
      };
      const patches = this.package.generateDependencyPatches(newDeps);
      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(4);

      expect(patches[2]).to.be.an.instanceof(Patch);
      expect(patches[2].type).to.equal(Patch.ADD);
      expect(patches[2].name).to.equal('dependency-3');
      expect(patches[2].files).to.deep.equal(['file-3.mjs']);
    });

    it('should generate add patches for new devDependencies', function () {
      const newDeps = {
        'dev-dependency-3': {
          files: ['test.mjs']
        }
      };
      const patches = this.package.generateDependencyPatches(newDeps);
      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(4);

      expect(patches[0]).to.be.an.instanceof(Patch);
      expect(patches[0].type).to.equal(Patch.ADD);
      expect(patches[0].name).to.equal('dev-dependency-3');
      expect(patches[0].files).to.deep.equal(['test.mjs']);
    });

    it('should generate remove patches for unused dependencies', function () {
      const newDeps = {};
      const patches = this.package.generateDependencyPatches(newDeps);
      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(3);

      expect(patches[0]).to.be.an.instanceof(Patch);
      expect(patches[0].type).to.equal(Patch.REMOVE);
      expect(patches[0].name).to.equal('dependency-1');
      expect(patches[0].files).to.deep.equal([]);

      expect(patches[1]).to.be.an.instanceof(Patch);
      expect(patches[1].type).to.equal(Patch.REMOVE);
      expect(patches[1].name).to.equal('dependency-2');
      expect(patches[1].files).to.deep.equal([]);
    });
  });

  describe('#generateInheritPatches', function () {
    it('should generate inherit patches for fields defined in packageJson#comptroller', function () {
      const patches = this.package.generateInheritPatches();
      expect(patches).to.be.an('array');
      expect(patches.length).to.equal(2);

      expect(patches[0]).to.be.an.instanceof(Patch);
      expect(patches[0].type).to.equal(Patch.INHERIT);
      expect(patches[0].name).to.equal('version');

      expect(patches[1]).to.be.an.instanceof(Patch);
      expect(patches[1].type).to.equal(Patch.INHERIT);
      expect(patches[1].name).to.equal('author');
    });
  });

  describe('#applyPatch(patch)', function () {
    it('should correctly apply add patch', function () {
      const patch = new Patch(Patch.ADD, {
        name: 'dependency-3',
        value: '0.0.2',
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.dependencies).to.deep.equal({
        'dependency-1': '0.0.0',
        'dependency-2': '0.0.1',
        'dependency-3': '0.0.2',
        'unused-dependency': '0.0.0'
      });
    });

    it('should correctly apply dev add patch', function () {
      const patch = new Patch(Patch.ADD, {
        name: 'dev-dependency-3',
        value: '7.7.7',
        dev: true,
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.devDependencies).to.deep.equal({
        'dev-dependency-1': '9.9.9',
        'dev-dependency-2': '8.8.8',
        'dev-dependency-3': '7.7.7',
      });
    });

    it('should correctly apply update patch', function () {
      const patch = new Patch(Patch.UPDATE, {
        name: 'dependency-3',
        value: '0.0.2',
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.dependencies).to.deep.equal({
        'dependency-1': '0.0.0',
        'dependency-2': '0.0.1',
        'dependency-3': '0.0.2',
        'unused-dependency': '0.0.0',
      });
    });

    it('should correctly apply dev update patch', function () {
      const patch = new Patch(Patch.ADD, {
        name: 'dev-dependency-1',
        value: '10.10.10',
        dev: true,
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.devDependencies).to.deep.equal({
        'dev-dependency-1': '10.10.10',
        'dev-dependency-2': '8.8.8',
      });
    });

    it('should correctly apply remove patch', function () {
      const patch = new Patch(Patch.REMOVE, {
        name: 'dependency-2',
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.dependencies).to.deep.equal({
        'dependency-1': '0.0.0',
        'unused-dependency': '0.0.0',
      });
    });

    it('should correctly apply inherit patch', function () {
      const patch = new Patch(Patch.INHERIT, {
        name: 'author',
        value: 'some persons name',
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.author).to.equal('some persons name');
    });

    it('should ignore disabled patch', function () {
      const patch = new Patch(Patch.INHERIT, {
        name: 'version',
        value: '6.6.6',
        disabled: true,
      });
      this.package.applyPatch(patch);
      expect(this.package.packageJson.version).to.equal('0.0.1');
    });
  });

  describe('#writePackageJson', function () {
    it('should write packageJson to package.json', async function () {
      const newPackageJson = this.package._packageJson = {
        name: 'some-other-package',
        version: '6.6.6',
        repository: {
          type: 'git',
          url: 'git+https://github.com/Aldlevine/comptroller.git'
        }
      };
      await this.package.writePackageJson();
      expect(await fs.readJsonPlease(path.resolve(this.package.root, 'package.json'))).to.deep.equal(newPackageJson);
    });
  });
});
