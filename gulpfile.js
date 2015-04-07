  // all the requirements - created with Gulp Fiction
  // when running gulp and you get errors make sure all these are installed in your local project
  var gulp = require("gulp");
  var plumber = require('gulp-plumber');
  var inject = require('gulp-inject');
  var sass = require('gulp-sass');
  var uglify = require('gulp-uglify');
  var uglifycss = require('gulp-uglifycss');
  var concat = require("gulp-concat");
  var gulpif = require('gulp-if');
  var htmlmin = require('gulp-html-minifier');
  var cheerio = require('gulp-cheerio');
  var rev = require('gulp-rev');
  var clean = require('gulp-clean');
  var uncss = require('gulp-uncss');
  var csso = require('gulp-csso');

//blank defaut task. Just let it go dude.
gulp.task("default", []);


gulp.task('html:prod', function () {
  gulp.src('./src/*.html')
    .pipe(gulp.dest('./'));
  });

gulp.task('sass', function () {
  gulp.src('./src/scss/theme.scss')
    .pipe(plumber())
		.pipe(sass())
    .pipe(gulp.dest('src/css'));
});

gulp.task('css:prod', function () {
  gulp.src('./src/**/*.css')
    .pipe(concat("global.css"))
    .pipe(uglifycss())
    .pipe(gulp.dest('./css'));
  });

gulp.task('js:prod', function(){
  gulp.src('./src/js/*.js')
    .pipe(concat("global.js"))
    .pipe(uglify({preserveComments : false,mangle : false}))
    .pipe(gulp.dest('js'));
    });

gulp.task('watch:production', function() {
  gulp.watch('./src/scss/*.scss', ['css:prod']);
  gulp.watch('./src/js/*.js', ['js:prod']);
  gulp.watch('./src/*.html', ['html:prod']);
  });

//BUILD SCRIPTS
gulp.task('build:prod', function() {
  gulp.start('sass:build', 'js:prod', 'html:prod', 'css:prod');
});

////build all your dev stuff
gulp.task('build:dev', function () {
  gulp.start('css:dev', 'js:dev', 'html:dev');
});
  
  
////Bruteforce templating////
gulp.task('html:dev',function(){
  gulp.src('./src/templates/*.html')//MAKE THIS YOUR FILENAME OR WILDCARD IT *.HTML
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_1col.html']), {starttag: '<!-- inject:cont_span_1col:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_2col_stack.html']), {starttag: '<!-- inject:cont_span_2col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_3col_stack.html']), {starttag: '<!-- inject:cont_span_3col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_4col_stack.html']), {starttag: '<!-- inject:cont_span_4col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_4col_stack_2x2.html']), {starttag: '<!-- inject:cont_span_4col_stack_2x2:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_5col_stack.html']), {starttag: '<!-- inject:cont_span_5col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_6col_stack.html']), {starttag: '<!-- inject:cont_span_6col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/span/cont_span_6col_stack_2x2.html']), {starttag: '<!-- inject:cont_span_6col_stack_2x2:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_1col.html']), {starttag: '<!-- inject:cont_1col:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_1col_ctr_lg.html']), {starttag: '<!-- inject:cont_1col_ctr_lg:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_1col_ctr_md.html']), {starttag: '<!-- inject:cont_1col_ctr_md:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_1col_ctr_sm.html']), {starttag: '<!-- inject:cont_1col_ctr_sm:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col.html']), {starttag: '<!-- inject:cont_2col:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_12-12_imglt.html']), {starttag: '<!-- inject:cont_2col_12-12_imglt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_12-12_imgrt.html']), {starttag: '<!-- inject:cont_2col_12-12_imgrt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_13-23_imglt.html']), {starttag: '<!-- inject:cont_2col_13-23_imgrt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_13-23_imgrt.html']), {starttag: '<!-- inject:cont_2col_13-23_imglt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_14-34_imglt.html']), {starttag: '<!-- inject:cont_2col_14-34_imglt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_14-34_imgrt.html']), {starttag: '<!-- inject:cont_2col_14-34_imgrt:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_2col_stack.html']), {starttag: '<!-- inject:cont_2col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_3col.html']), {starttag: '<!-- inject:cont_3col:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_3col_stack.html']), {starttag: '<!-- inject:cont_3col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_4col_stack.html']), {starttag: '<!-- inject:cont_4col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_4col_stack_2x2.html']), {starttag: '<!-- inject:cont_4col_stack_2x2:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_5col_stack.html']), {starttag: '<!-- inject:cont_5col_stack:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/containers/std/cont_6col_stack_2x3.html']), {starttag: '<!-- inject:cont_6col_stack_2x3:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/footer.html']), {starttag: '<!-- inject:footer:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/form_custom.html']), {starttag: '<!-- inject:form_custom:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/header.html']), {starttag: '<!-- inject:header:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/header_mini.html']), {starttag: '<!-- inject:header_mini:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/hero.html']), {starttag: '<!-- inject:hero:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/map.html']), {starttag: '<!-- inject:map:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/meta.html']), {starttag: '<!-- inject:meta:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/tabs.html']), {starttag: '<!-- inject:tabs:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/tabs_mobile.html']), {starttag: '<!-- inject:tabs_mobile:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
.pipe(inject(gulp.src(['./src/templates/fragments/tabs_side.html']), {starttag: '<!-- inject:tabs_side:{{ext}} -->',transform: function (filePath, file) { return file.contents.toString('utf8')} }))
//.pipe(htmlmin({removeComments: true }))
//.pipe(htmlmin({collapseWhitespace: true })) UGLIFY HTML
.pipe(cheerio(function ($, file) {
  $("img:not([alt])").attr("alt", ""); //this adds a blank alt tag to images without an alt
}))
.pipe(gulp.dest('./dev'));
});

gulp.task('js:dev', function(){
        gulp.src('./src/js/*.js')
            .pipe(concat("global.js"))
            //.pipe(uglify())
            .pipe(rev())
            .pipe(gulp.dest('./dev/js/'));
});

gulp.task('css:dev', function () {
  gulp.start('nukecss:dev')
  gulp.src('./src/scss/style.scss')
    .pipe(plumber())
    .pipe(concat("global.css"))
    .pipe(sass())
    //.pipe(uncss({html: ['dev/*.html','src/**/*.html'] }))
    .pipe(csso())
    .pipe(uglifycss())
    //.pipe(rev())
    .pipe(gulp.dest('./dev/css/'));
});
//this deletes unwanted selectors
gulp.task('csso:dev', function() {
  return gulp.src('dev/css/*.css')
    .pipe(uncss({html: ['dev/*.html','src/**/*.html'] }))
    .pipe(csso())
    .pipe(gulp.dest('./out'));
});


//NUCLEAR OPTIONS the delete directory contents
gulp.task('stoneage:dev', function () {
  gulp.start('nukecss:dev', 'nukejs:dev', 'nukehtml:dev');
});
gulp.task('nukecss:dev', function () {
  return gulp.src('dev/css/*.css', {read: false})
    .pipe(clean());
});
gulp.task('nukejs:dev', function () {
  return gulp.src('dev/js/*.js', {read: false})
    .pipe(clean());
});
gulp.task('nukehtml:dev', function () {
  return gulp.src('dev/*.html', {read: false})
    .pipe(clean());
});
gulp.task('nukeimages:dev', function () {
  return gulp.src('dev/img/*.*', {read: false})
    .pipe(clean());
});
gulp.task('nukefonts:dev', function () {
  return gulp.src('dev/fonts/*.*', {read: false})
    .pipe(clean());
});
