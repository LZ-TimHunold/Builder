# Builder
Gulp process for templates, JS and SASS. This documentation's premise is to document the workings of the development process of the project, the build process for the project & patterns used throughout the project for future development by LZ.

# Development

Development is done via [node.js](http://nodejs.org) and along with GulpJs for tasks such as compiling `.scss` files into `.css` and building `.js` files from many others. This is needed for working on additional assets/pages. The process is doumented below.

## Setup 

**Install Node.js**

  * [node.js](http://nodejs.org)

### Install local dependencies via Terminal commands

CD to your working directory and run each of these commands. There will be a PowerShell or batch file coming shortly to do this for you. Until then go line by line. If there are errors, please contact Tim.

```
npm install gulp -g
npm install --save gulp-concat
npm install --save-dev gulp-plumber
npm install --save-dev gulp-inject
npm install gulp-sass
npm install --save-dev gulp-uglify
npm install --save gulp-uglifycss
npm install --save gulp-uglifyjs
npm install gulp-htmlclean --save-dev
npm install gulp-if
npm update
```

** Configure your Gulp and Package files**

You will need both a gulpfile.js and a package.json file.

*** Gulpfile.js***

This file holds all the tasks you can run from gulp. Just typing "gulp" will run the default function, but you can break these up.

** Package.json**

This is more of a manifest file that contains things like name and ownership along with library versions.

## Working

Open a Terminal window and type:

#### Development Viewing

There are two ways
1) in explorer go to your dev folder and open your file
2) if you push to Github and want to share