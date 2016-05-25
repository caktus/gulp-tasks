
var source = require('vinyl-source-stream'); // Used to stream bundle for further handling
var browserify = require('browserify');
var watchify = require('watchify');
var babelify = require('babelify');
var gulpif = require('gulp-if');
var uglify = require('gulp-uglify');
var streamify = require('gulp-streamify');
var notify = require('gulp-notify');
var concat = require('gulp-concat');
var cssmin = require('gulp-cssmin');
var gutil = require('gulp-util');
var rename = require("gulp-rename");
var less = require('gulp-less');
var glob = require('glob');
var path = require('path');
var livereload = require('gulp-livereload');
var modernizr = require('gulp-modernizr');
var fileExists = require('file-exists');
var mocha = require('gulp-mocha');
var istanbul = require('gulp-istanbul');
var isparta = require('isparta');
var coverageEnforcer = require('gulp-istanbul-enforcer');

var spawn = require('child_process').spawn;

var argv;

module.exports = function tasks(gulp, defaults) {
  var defaults = arguments.length === 1 ? {
    'port': 8000,
    'address': 'localhost',
  } : defaults;
  argv = require('yargs')
    .default('port', defaults.port)
    .default('address', defaults.address)
    .array('deps')
    .default('deps', [])
    .default('project_name', defaults.project_name)
    .default('static-root', defaults.static_root)
    .boolean('runserver')
    .default('runserver', defaults.runserver || false)
    .argv;

  function static() {
    var static_root = argv['static-root'] || path.join(argv.project_name, 'static');
    Array.prototype.splice.call(arguments, 0, 0, static_root)
    return path.join.apply(this, arguments);
  }
  tasks.static = static;

  function modernizrTask(options) {
    if (!options.development || !fileExists(path.join(options.dest, "modernizr.js"))) {
      gulp.src(options.src)
        .pipe(modernizr())
        .pipe(uglify())
        .pipe(gulp.dest(options.dest));
    }
  }
  exports.modernizr = modernizrTask;

  var browserifyTask = function (options) {

    modernizrTask({
      src: options.src,
      dest: path.join(options.dest, "../libs"),
      development: options.development,
    });

    // Our app bundler
    var appBundler = browserify({
      entries: [options.src], // Only need initial file, browserify finds the rest
      transform: [babelify], // We want to convert JSX to normal javascript
      debug: options.development, // Gives us sourcemapping
      cache: {}, packageCache: {}, fullPaths: options.development // Requirement of watchify
    });

    // We set our dependencies as externals on our app bundler when developing
    (options.development ? argv.deps : []).forEach(function (dep) {
      appBundler.external(dep);
    });

    // The rebundle process
    var rebundle = function () {
      var start = Date.now();
      console.log('Building APP bundle');
      appBundler.bundle()
        .on('error', gutil.log)
        .pipe(source('index.js'))
        .pipe(gulpif(!options.development, streamify(uglify())))
        .pipe(rename('bundle.js'))
        .pipe(gulp.dest(options.dest))
        .pipe(gulpif(options.development, livereload()))
        .pipe(notify(function () {
          console.log('APP bundle built in ' + (Date.now() - start) + 'ms');
        }));
    };

    // Fire up Watchify when developing
    if (options.development) {
      appBundler = watchify(appBundler);
      appBundler.on('update', rebundle);
    }

    rebundle();

    // We create a separate bundle for our dependencies as they
    // should not rebundle on file changes. This only happens when
    // we develop. When deploying the dependencies will be included
    // in the application bundle
    if (options.development) {

      var vendorsBundler = browserify({
        debug: true,
        require: argv.deps
      });

      // Run the vendor bundle
      var start = new Date();
      console.log('Building VENDORS bundle');
      vendorsBundler.bundle()
        .on('error', gutil.log)
        .pipe(source('vendors.js'))
        .pipe(gulpif(!options.development, streamify(uglify())))
        .pipe(gulp.dest(options.dest))
        .pipe(notify(function () {
          console.log('VENDORS bundle built in ' + (Date.now() - start) + 'ms');
        }));
    }
  };

  var cssTask = function (options) {
      var lessOpts = {
        relativeUrls: true,
      };
      if (options.development) {
        var run = function () {
          var start = new Date();
          console.log('Building CSS bundle');
          gulp.src(options.src)
            .pipe(gulpif(options.development, livereload()))
            .pipe(concat('index.less'))
            .pipe(less(lessOpts))
            .pipe(rename('bundle.css'))
            .pipe(gulp.dest(options.dest))
            .pipe(notify(function () {
              console.log('CSS bundle built in ' + (Date.now() - start) + 'ms');
            }));
        };
        run();
        gulp.watch(options.watch, run);
      } else {
        gulp.src(options.src)
          .pipe(concat('index.less'))
          .pipe(less(lessOpts))
          .pipe(rename('bundle.css'))
          .pipe(cssmin())
          .pipe(gulp.dest(options.dest));
      }
  };

  function rebuild(options) {
    var options = options || {};

    if (typeof defaults.preBuild === "function") {
      defaults.postBuild(options);
    }

    Promise.all([
      browserifyTask({
        development: options.development,
        src: static('js/index.js'),
        dest: static('js'),
      }),
      cssTask({
        development: options.development,
        src: static('less/index.less'),
        watch: static('less/**/*.less'),
        dest: static('css'),
      }),
    ]).then(function(){
      if (typeof defaults.postBuild === "function") {
        defaults.postBuild(options);
      }
    })
  }

  // Starts our development workflow
  gulp.task('default', function (cb) {
    livereload.listen();

    rebuild({
      development: true,
    });

    if (argv.runserver) {
      console.log("Starting Django runserver http://"+argv.address+":"+argv.port+"/");
      var args = ["manage.py", "runserver", argv.address+":"+argv.port];
      // Newer versions of npm mess with the PATH, sometimes putting /usr/bin at the front,
      // so make sure we invoke the python from our virtual env explicitly.
      var python = process.env['VIRTUAL_ENV'] + '/bin/python';
      var runserver = spawn(python, args, {
        stdio: "inherit",
      });
      runserver.on('close', function(code) {
        if (code !== 0) {
          console.error('Django runserver exited with error code: ' + code);
        } else {
          console.log('Django runserver exited normally.');
        }
      });
    }

    if (defaults.default_extra) {
      defaults.default_extra();
    }
  });

  gulp.task('build', function() {
    rebuild({
      development: false,
    });
  });

  gulp.task('test', function () {
    require('babel-core/register');
    return gulp
      .src(static('js/app/**/*.js'))
      .pipe(istanbul({
        instrumenter: isparta.Instrumenter
        , includeUntested: true
      }))
      .pipe(istanbul.hookRequire())
      .on('finish', function () {
        gulp
          .src(static('/js/test/**/test_*.js'), {read: false})
          .pipe(mocha({
            require: [
              'jsdom-global/register'
            ]
          }))
          .pipe(istanbul.writeReports({
            dir: './coverage/'
            , reportOpts: {
              dir: './coverage/'
            }
            , reporters: [
              'text'
              , 'text-summary'
              , 'json'
              , 'html'
            ]
          }))
          .pipe(coverageEnforcer({
            thresholds: {
              statements: 80
              , branches: 50
              , lines: 80
              , functions: 50
            }
            , coverageDirectory: './coverage/'
            , rootDirectory: ''
          }))
        ;
      })
    ;
  });

  return {};
};
