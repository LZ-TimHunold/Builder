# Builder
Gulp process for templates, JS and SASS. This documentation's premise is to document the workings of the development process of the project, the build process for the project & patterns used throughout the project for future development by LZ.

# Development

Development is done via [node.js](http://nodejs.org) powering a static server for rendering routed pages; along with tasks such as compiling `.scss` files into `.css` and building `.js` files from many others. This is needed for working on additional assets/pages. The process is doumented below.

## Setup 

**Install Node.js**

  * [node.js](http://nodejs.org)

### Install local dependencies via Terminal commands

```bash
npm install -g gulp
```

## Working

Open a Terminal window and type: 

#### Development Viewing

There are two ways
1) in explorer go to your dev folder and open your file
2) if you push to Github and want to share