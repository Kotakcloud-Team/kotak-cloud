import { KotakCloudClient } from "../src";

const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";

const kotakCloud = new KotakCloudClient({});

describe("Kotak Cloud Client", () => {
  const login = () => {
    return kotakCloud.login({
      email: EMAIL,
      password: PASSWORD,
    });
  };

  beforeEach(async () => {
    await login();
    return true;
  });

  test("login", async () => {
    const response = await login();

    expect(response.status).toBe(200);
    expect(response.user?.email).toBe(EMAIL);

    const token = kotakCloud.token();

    expect(response.token).toBe(token);
  });

  test("login error", async () => {
    const response = await kotakCloud.login({
      email: EMAIL,
      password: PASSWORD + "1",
    });

    expect(response.status).toBe(401);
    expect(typeof response.error?.message).toBe("string");
  });

  test("logout", async () => {
    const token = kotakCloud.token();
    const response = await kotakCloud.logout();

    expect(response.status).toBe(200);
    expect(response.token).toBe(token);
  });

  test.todo("uploadFiles");

  test("createFolder", async () => {
    const response = await kotakCloud.createFolder({
      name: "sample",
      parentId: "",
    });

    expect(response.status).toBe(201);
    expect(response?.data?.name).toBe("sample");
  });

  test("getFoldersFiles", async () => {
    const response = await kotakCloud.getFiles();

    expect(typeof response.total).toEqual("number");
    expect(response.data).toBeTruthy();
  });

  test("getBreadCrumbs", async () => {
    const createFolder = await kotakCloud.createFolder({
      name: "sample",
      parentId: "",
    });
    const response = await kotakCloud.getBreadCrumbs(createFolder?.data?._id);

    expect(response).toBeTruthy();
    expect(response.length).toBeGreaterThanOrEqual(1);
  });

  test("deleteFoldersFiles", async () => {
    const files = (await kotakCloud.getFiles()).data.splice(0, 2);
    const response = await kotakCloud.deleteFiles(files);

    expect(response.data.length).toEqual(files.length);
  });
});
