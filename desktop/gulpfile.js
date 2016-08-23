var gulp = require('gulp');
var gutil = require('gulp-util');
var gulpFail = require('gulp-fail');
var path = require('path');
var ElectronPackager = require('electron-packager');
var child_process = require('child_process');
var fs = require('fs');
var plist = require('plist');
var $ = require('gulp-load-plugins')();
var open = require('gulp-open');
var runSequence = require('run-sequence');

var BUILD_VERSION = "0.7.1";

var SIGN_PACKAGE = process.env['SIGN_DECO_PACKAGE'] == 'true'

var child = null
var debug_child = null
gulp.task('clean-pkg', $.shell.task(["rm -rf " + (path.join(__dirname, '../dist')), "mkdir -p " + (path.join(__dirname, '../dist/osx'))]));

gulp.task('copy-libraries', ['electron-pack'], $.shell.task(["mkdir " + '../app/deco/Deco-darwin-x64/Deco.app/Contents/Resources/app.asar.unpacked', "cp -rf " + (path.join(__dirname, './package/deco_unpack_lib/*')) + " " + (path.join(__dirname, '../app/deco/Deco-darwin-x64/Deco.app/Contents/Resources/app.asar.unpacked/'))]));

gulp.task('dev-unpack-lib', function(callback) {
  var _child;
  _child = child_process.execSync((path.join(__dirname, './Scripts/postinstall')) + " dev " + (path.join(__dirname, './deco_unpack_lib')), {
    cwd: __dirname
  });
  return callback();
});

gulp.task('modify-plist', ['copy-libraries'], function(callback) {
  var info, plistPath;
  plistPath = path.join(__dirname, '../app/deco/Deco-darwin-x64/Deco.app/Contents/Info.plist');
  info = plist.parse(fs.readFileSync(plistPath, 'utf8'));
  info.NSAppTransportSecurity = {
    NSAllowsArbitraryLoads: true
  };
  info.LSMinimumSystemVersion = "10.9.0";
  fs.writeFileSync(plistPath, plist.build(info));
  return callback();
});

gulp.task('dist', ['modify-plist'], function(callback) {
  return child_process.execFileSync(path.join(__dirname, '/ship_n_zip.sh'), [BUILD_VERSION, SIGN_PACKAGE], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env
  });
});

gulp.task('setup-pack-folder', ['build'], function(callback) {
  var packagePath;
  packagePath = path.join(__dirname, 'package');
  child_process.execSync('rm -rf ' + packagePath + '/*');
  child_process.execSync('mkdir -p ' + packagePath);
  child_process.execSync('cp -rf ' + path.join(__dirname, 'build') + ' ' + path.join(packagePath, 'build'));
  child_process.execSync('cp -rf ' + path.join(__dirname, 'deco_unpack_lib') + ' ' + packagePath);
  child_process.execSync('cp -rf ' + path.join(__dirname, 'Scripts/postinstall') + ' ' + path.join(packagePath, 'deco_unpack_lib/Scripts/postinstall'))
  child_process.execSync('rm -rf ' + path.join(__dirname, 'public', 'bundle.js.map'));
  child_process.execSync('cp -rf ' + path.join(__dirname, 'public') + ' ' + packagePath);
  child_process.execSync('cp -rf ' + path.join(__dirname, 'node_modules') + ' ' + packagePath);
  child_process.execSync('cp -rf ' + path.join(__dirname, 'assets') + ' ' + packagePath);
  child_process.execSync('cp -rf ' + path.join(__dirname, 'package.json') + ' ' + packagePath);
  return callback();
});

gulp.task('electron-pack', ['setup-pack-folder'], function(callback) {
  var opts = {
    name: 'Deco',
    dir: path.join(__dirname, './package'),
    arch: 'all',
    platform: 'darwin',
    icon: path.join(__dirname, '/assets/icons/deco.icns'),
    version: '1.1.2',
    appVersion: BUILD_VERSION,
    overwrite: true,
    ignore: /deco_unpack_lib\/.*/g,
    out: path.join(__dirname, '../app/deco'),
    asar: true
  };
  if (SIGN_PACKAGE) {
    opts.sign = 'Developer ID Application: Deco Software Inc. (M5Y2HY4UM2)'
  }

  opts['app-bundle-id'] = 'com.decosoftware.deco';
  opts['build-version'] = BUILD_VERSION;
  return ElectronPackager(opts, function(err, appPath) {
    if (err) {
      console.error(err);
      return gulpFail();
    } else {
      console.log('finished, app written to ' + appPath);
      return callback();
    }
  });
});

// Apply babel transformation
function transform(params) {
  const sourceMaps = params && params.dev ? ' -s inline' : ''

  // Get babel-cli binary from node_modules
  const bin = path.join(__dirname, 'node_modules/.bin', 'babel')

  function createCommand(src, dest, presets) {
    return bin + ' ' + src + ' -d ' + dest + ' --presets ' + presets.join(',') + sourceMaps
  }

  // Transform src -> build
  child_process.execSync(createCommand('src', 'build', ['es2015', 'stage-1']))

  // Transform ../shared/src -> node_modules/shared
  const sharedSrc = path.join(__dirname, '../shared/src')
  const sharedDest = path.join(__dirname, 'node_modules/shared')
  child_process.execSync(createCommand(sharedSrc, sharedDest, ['es2015']))

  // Copy shared package.json so npm doesn't warn on npm install
  const sharedPackageSrc = path.join(sharedSrc, '../package.json')
  const sharedPackageDest = path.join(sharedDest, 'package.json')
  child_process.execSync("cp " + sharedPackageSrc + ' ' + sharedPackageDest)
}

gulp.task("build", function(callback) {
  transform()
  return callback()
})

gulp.task("build-dev", function(callback) {
  transform({dev: true})
  return callback()
})

gulp.task('build-web', ['build', 'clean-pkg'], function(callback) {
  child_process.execSync('npm run build', {
    cwd: path.join(__dirname, '../web')
  });
  child_process.execSync("cp -r " + (path.join(__dirname, '../web/public')) + " " + (path.join(__dirname, './')));
  return callback();
});

gulp.task("start", ["build"], function(callback) {
  child = child_process.fork("" + (path.join(__dirname, './node_modules/.bin/electron')), [__dirname, "--dev-mode"], {
    cwd: __dirname,
    env: process.env
  });
});

gulp.task('debug', ['run-debug-processes'], function(callback) {
  gulp.src(__filename)
  .pipe(open({
    uri: 'http://127.0.0.1:3000/?port=5858',
    //TODO: needs to change for OS once we support other platforms
    app: '/Applications/Google\ Chrome.app',
  }))
  callback()
});

gulp.task("run-debug-processes", ["build-dev"], function(callback) {
  child = child_process.fork("" + (path.join(__dirname, './node_modules/.bin/electron')), ["--debug-brk=5858", __dirname, "--dev-mode"], {
    cwd: __dirname,
    env: process.env
  });
  debug_child = child_process.fork("" + (path.join(__dirname, './node_modules/.bin/electron')), [
    "node_modules/node-inspector/bin/inspector.js",
    "--web-port=3000",
  ], {
    cwd: __dirname,
    env: Object.assign({},
      process.env, {
        ELECTRON_RUN_AS_NODE: true,
      })
  });
  callback()
})

process.on('exit', function() {
  if (child != null && !child.killed) {
    child.kill();
  }
  if (debug_child != null && !debug_child.killed) {
    debug_child.kill();
  }
});

gulp.task('default', function() {
  return gulp.start('pack');
});

gulp.task('process-new-project-template', function(callback) {
  var oldProjectPath = path.join(__dirname, 'deco_unpack_lib/Project');
  var newProjectPath = gutil.env.projectPath;
  var nodeModulesPath = path.join(__dirname, 'deco_unpack_lib/Project/node_modules');
  var nodeModulesArchive = path.join(__dirname, 'deco_unpack_lib/modules.tar.gz');
  var projectBinary = path.join(__dirname, 'deco_unpack_lib/Project/Project.app');
  var binaryDestination = path.join(__dirname, 'deco_unpack_lib/Project/ios/build/Build/Products/Debug-iphonesimulator');

  fs.stat(newProjectPath, function(err, stat) {
    if (err == null) {
      console.log('Preparing project directory...');
      child_process.execSync('rm -rf ' + oldProjectPath);
      child_process.execSync('cp -rf ' + newProjectPath + ' ' + oldProjectPath);

      fs.stat(projectBinary, function(err, stat) {
        if (err == null) {
          console.log('Creating the modules archive...');
          child_process.execSync('tar -cvzf ' + nodeModulesArchive + ' -C ' + oldProjectPath + ' node_modules');

          console.log('Copying the binary...');
          child_process.execSync('mkdir -p ' + binaryDestination);
          child_process.execSync('cp -rf ' + projectBinary + ' ' + binaryDestination + '/Project.app');

          console.log('Cleaning up...');
          child_process.execSync('rm -rf ' + projectBinary);
          child_process.execSync('rm -rf ' + nodeModulesPath);

          callback();
        } else {
          console.log('Error: Please copy the "Project.app" binary file into the root of your "Project" dir.');
          callback(err);
        }
      });
    } else {
      console.log('Error: Nothing found at the path specified.');
      callback(err);
    }
  });

});

gulp.task('upgrade-project-template', function() {
  runSequence('process-new-project-template', 'dev-unpack-lib');
});

gulp.task('pack', [
  'clean-pkg',
  'build',
  'build-web',
  'setup-pack-folder',
  'electron-pack',
  'copy-libraries',
  'modify-plist',
  'dist']);
