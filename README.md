TOC: [Builder](#builder) | [Development](#development) | [Setup](#setup) | [DOM Manipulation](#dom-manipulation-from-gulp) | [Running](#running) | [Viewing](#development-viewing)

# Builder
Gulp process for templates, JS and SASS. This documentation's premise is to document the workings of the development process of the project, the build process for the project & patterns used throughout the project for future development by LZ.

# Development
Development is done via [node.js](http://nodejs.org) and along with [GulpJs](http://gulpjs.com/) for tasks such as compiling `.scss` files into `.css` and building `.js` files from many others. This is needed for working on additional assets/pages. The process is doumented below.

## Setup 

**Install Node.js**

  * [node.js](http://nodejs.org)

Node is really only going top be used for node package manager aka [NPM](https://www.npmjs.com/) Everything (almost) you will need will be in this directory.

**Install local dependencies via command line**

`CD` to your working directory and run each of these at the command line. There will be a PowerShell or batch file coming shortly to do this for you. Until then go line by line. If there are errors, please contact Tim H.

```
npm install gulp -g
npm install gulp-if gulp-cheerio gulp-sass gulp-rename gulp-util vinyl-source-stream vinyl-buffer
npm install --save gulp-concat gulp-uglifycss gulp-uglifyjs
npm install --save-dev gulp-plumber gulp-inject gulp-uglify gulp-uncss gulp-csso gulp-htmlclean gulp-dev gulp-filter gulp-useref gulp-rev-replace gulp-browserify
npm update
```

**Configure your Gulp and Package files**

You will need both a `gulpfile.js` and a `package.json` file for anything to work properly.

**Configure Gulpfile.js**

This file holds all the tasks you can run from gulp. Just typing "gulp" will run the default function, but you can break these up. For best practices, leave the default function blank. If you don't have a default, you run the risk of gulp failing to run any tasks at all.

The anantomy of the file is broken up in to two distinct areas. The top of the doc defines the `var` and the next block contains the functions. If in calling a function, the var is not properly set or the library was not properly installed via [NPM](https://www.npmjs.com/), you risk no gulp tasks running at all.

***You can auto-build a `gulpfile.js`*** using an online tool such as [GulpFiction](http://gulpfiction.divshot.io/) and it will also build a `package.json` file for you.

This is the `default` task, it is blank intentionally to avoid forcing yourself to create a "one task fits all" function. Please don't mess with this.

```
gulp.task("default", [], function () {
});
```

Typing `c:\myrepo\gulp` will run `default`
Typing `c:\myrepo\gulp new_task` will run the task `new_task`

```
gulp.task("new_task", [], function () {
    gulp.src([{"path":".src/*.html"}])
        .pipe(inject(.src/header.html))
        .pipe(gulp.dest("./"));
});
```

Using `gulp.watch` to watch directories or files for a change and automatically run a specified function can be helpful, provided you don't make rapid changes like saving a file and then editing and saving again while the gulp task is still running. It's like trying to jam food into your already full mouth. You won't gulp, you'll choke.

This task is called by typing `c:\myrepo\gulp watch` and it will watch a source directory for a change and then run the other task `new_task`. It is often used to watch for compiling `css` or `js`.

```
gulp.task("watch", [], function () {
    gulp.watch("./src/**/*.html", ["new_task"]);
});
```

If you want to group many tasks, typing `c:\myrepo\gulp build` will run the tasks `default` and `sass:build`.

```
gulp.task('build', function() {
  gulp.start('default', sass:build', 'js:prod');
  });
```

**Configure Package.json**

This is a manifest file that contains things like name and ownership along with library versions. You should not need to directly edit *this* file other than to perhaps add your name to the contributors list. 

[GulpFiction](http://gulpfiction.divshot.io/) will also build a `package.json` file for you.

[package.json validator](http://package-json-validator.com/) will help you should you go down the dangerous road of `npm update` and `package.json` errors.

### DOM Manipulation from Gulp
Thanks to `gulp-cheerio` we can run jQuery in the `gulpfile.js`. Here4 is a file that adds a blank `alt` tag to images without one.
```
.pipe(cheerio(function ($, file) {
  $("img:not([alt])").attr("alt", "");
}))
```


## Running
Once you have defined a task in gulpfile.js, in this example it is `mytask`, you are able to call it from the command line.
`c:\myrepo\gulp mytask`

If you get an error, please contact Tim. Most of the time it is a missing library, or you can add .pipe(plumber()) to your task to unstick it.

### Development Viewing
There are two ways
1. In explorer go to your dev folder and open your file.
	1.1 Remember that in your task `.pipe(gulp.dest("./"));` defines the destination *relative to* `gulpfile.js` where it outputs.
2. If you push to Github and want to share, use the `ghpages` branch in your project.
