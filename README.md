# KotakCloud SDK

This is the Official Browser client/library for [kotak.cloud](https://kotak.cloud) API.

## Installation

To install kotakcloud in a node project:

```bash
npm install --save @kontenbase/kotak-cloud
```

## Usage

```js
const { KotakCloudClient } = require("@kontenbase/kotak-cloud");

const kotakCloud = new KotakCloudClient();
```

## Authentication

Use kotakcloud auth services for get your token.

### Register

```js
const { user, token, error } = await kotakCloud.register({
  firstName: "Ega",
  lastName: "Radiegtya",
  email: "user@gmail.com",
  password: "password",
});
```

### Login

```js
const { user, token, error } = await kotakCloud.login({
  email: "user@gmail.com",
  password: "password",
});
```

### User

```js
const { user, error } = await kotakCloud.user();
```

### Logout

```js
const { user, token, error } = await kotakCloud.logout();
```

## Files

### Upload Files

```js
async function handleFileSelect(event) {
  const files = event.target.files;
  await kotakCloud.uploadFiles(
    files, // files to upload
    "", // folder parent
    console.log // onProgress
  );
}
```

### Create Folder

```js
const { data, error } = await kotakCloud.createFolder({ name, parentId });
```

### Get Files

```js
const { data, total, error } = await kotakCloud.getFiles();
```

### Get Breadcrumbs

```js
const breadcrumbs = await kotakCloud.getBreadCrumbs("622e89eb384d39937fd79777");
```

### Delete files

```js
const { data, errors } = await kotakCloud.deleteFiles(files);
```
