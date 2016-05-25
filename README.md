# gulp-tasks

Install this scoped package into your project:

```
npm install gulp --save-dev
npm install @caktus/gulp-tasks --save-dev
```

Use in a project's `gulpfile.js` like this:

```
require('@caktus/gulp-tasks')(require('gulp'), {
    project_name: "myproject",
});
```
## Release Notes

### Version 0.1.0

Added preBuild and postBuild options to support hooks for extra work to be done with builds on a
per-project basis.
