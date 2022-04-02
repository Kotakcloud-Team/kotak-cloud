import {
  FindOption,
  KontenbaseClient,
  KontenbaseCount,
  KontenbaseResponse,
  KontenbaseSingleResponse,
} from "@kontenbase/sdk";
import {
  AuthResponse,
  AuthResponseFailure,
  ProfileResponse,
} from "@kontenbase/sdk/dist/main/auth";
import axios, { AxiosInstance } from "axios";

import {
  Breadcrumb,
  Chunk,
  FileUpload,
  KotakCloudClientOptions,
  KotakCloudFile,
  Retry,
  UploadTask,
  User,
} from "./types";

export default class KotakCloudClient {
  private baseURL = "https://api.kotak.cloud";
  private kontenbase: KontenbaseClient;
  private currentToken: string | null = "";
  private currentUser: User | undefined;

  protected url = this.baseURL;
  protected maxRetry = 3;
  protected maxPool = 3;
  protected chunkSize = 512;
  protected httpRequest: AxiosInstance | undefined;
  protected currentTotal = {
    files: 0,
    folders: 0,
  };

  filesUpload: FileUpload[] = [];
  filesFilter: FindOption<KotakCloudFile> = {
    limit: 100,
    sort: {
      createdAt: -1,
    },
  };

  constructor(options?: KotakCloudClientOptions) {
    this.kontenbase = new KontenbaseClient({
      apiKey: "ef7523a3-cb9a-488f-ba10-e935053af794",
    });

    if (options?.url) {
      this.url = options.url;
    } else {
      this.switchVersion(options?.apiVersion);
    }

    if (options?.token) {
      this.saveToken(options.token);
    } else {
      this.saveToken(this.kontenbase.auth.token());
    }

    if (options?.maxRetry) this.maxRetry = options.maxRetry;
    if (options?.maxPool) this.maxPool = options.maxPool;
    if (options?.chunkSize) this.validateChunkSize(options.chunkSize);
  }

  private switchVersion = (apiVersion?: string) => {
    switch (apiVersion) {
      default:
        this.url = this.baseURL + "/api/v1";
        break;
    }
  };

  private validateChunkSize = (chunkSize: number) => {
    if (chunkSize > 512) {
      throw new Error("Chunk size cannot more than 512kb");
    }

    if (chunkSize <= 0) {
      throw new Error("Chunk size cannot less or equal 0");
    }

    this.chunkSize = chunkSize;
  };

  private setUpRequest = (token?: string | null) => {
    const instance = axios.create({
      baseURL: this.url,
      headers: {
        Authorization: `Bearer ${token || this.currentToken}`,
        keepAlive: true,
      },
    });

    this.httpRequest = instance;
  };

  // ============================== Auth Handler ==============================

  private normalizeAuthResult = async (response: AuthResponse<User>) => {
    if (response.user) {
      if (response.user.role?.[0] === "620c7627d04e01ea8b568a8c") {
        response.user.role = "admin";
      } else {
        response.user.role = "authenticated";
      }
    }

    if (response.token) {
      this.saveToken(response.token);
      this.setUpRequest(response.token);
    } else {
      await this.logout();
    }

    return response;
  };

  login = async (body: {
    email: string;
    password: string;
  }): Promise<AuthResponse<User>> => {
    return this.kontenbase.auth
      .login<User>(body)
      .then(this.normalizeAuthResult);
  };

  register = async (body: Partial<User>): Promise<AuthResponse<User>> => {
    return this.kontenbase.auth
      .register<User>(body)
      .then(this.normalizeAuthResult);
  };

  logout = (): Promise<AuthResponse<User>> => {
    this.httpRequest = undefined;
    this.currentToken = "";
    this.currentUser = undefined;
    return this.kontenbase.auth.logout();
  };

  user = async (): Promise<ProfileResponse<User>> => {
    if (this.currentUser) {
      return {
        user: this.currentUser,
        status: 200,
        statusText: "success",
      };
    }

    let response = await this.kontenbase.auth.user<User>();

    if (response.user) {
      if (response.user.role[0] === "admin") {
        response.user.role = "admin";
      } else {
        response.user.role = "authenticated";
      }

      this.currentUser = response.user;
      return response;
    }

    return response as AuthResponseFailure;
  };

  token = () => {
    return this.currentToken;
  };

  saveToken = (token: string | null) => {
    this.currentToken = token;
    if (token) {
      this.kontenbase.auth.saveToken(token);
      this.setUpRequest(token);
    }
  };

  // ============================== Upload Handler ==============================

  private updateFileUpload = (
    index: number,
    data: Partial<FileUpload>
  ): FileUpload[] => {
    const filesUpload = [...this.filesUpload];
    if (data.status === "finished") {
      delete filesUpload[index];
    } else {
      if (filesUpload[index].status === "error") {
        data.status = "error";
      }

      filesUpload[index] = {
        ...filesUpload[index],
        ...data,
      };
    }

    this.filesUpload = filesUpload;
    return filesUpload;
  };

  private KBtoB = (num: number) => {
    return 1024 * num;
  };

  private splitFile = (file: Partial<File>) => {
    const size = this.KBtoB(this.chunkSize);
    const fileChunks: Chunk[] = [];
    let index = 0; //Section num

    if (file.size && file.slice) {
      for (let cur = 0; cur < file.size; cur += size) {
        fileChunks.push({
          hash: index++,
          chunk: file.slice(cur, cur + size),
        });
      }
    }

    return fileChunks;
  };

  private retry = async ({ fn, trying = 0 }: Retry): UploadTask => {
    try {
      return await fn();
    } catch (error) {
      if (trying < this.maxRetry) {
        return this.retry({ fn, trying: ++trying });
      }

      throw error;
    }
  };

  private sendChunks = async (
    fileData: FileUpload,
    file: File | Blob,
    start: number = 0,
    cb: (data: Partial<FileUpload>) => void
  ) => {
    if (typeof this.httpRequest === "undefined") {
      throw new Error("You need to login/set token first!");
    }

    const chunks = this.splitFile(file);
    const { name, type, size, totalPart } = fileData;
    const fileParams = {
      filename: name,
      size: size,
      mimetype: type,
      folderId: fileData.folderId,
      totalPart,
    };

    // Concurrent pool
    const pool: UploadTask[] = [];

    let finish = start;
    let [id, fileId]: [string, string] = [
      fileData.id || "",
      fileData.fileId || "",
    ];

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (i < start) {
          continue;
        }

        const item = chunks[i];
        const formData = new FormData();
        formData.append("filename", name);
        formData.append("hash", `${item.hash}`);
        formData.append("chunk", item.chunk);

        const params = {
          ...fileParams,
          id,
          fileId,
          part: i,
          totalPart: Number(`${fileParams.totalPart}`),
        };

        const task = (this.httpRequest as AxiosInstance).post(
          `/file/upload${id ? `/${id}` : ""}`,
          formData,
          {
            params,
          }
        );

        const onSuccess = () => {
          finish++;

          cb({
            id,
            fileId,
            partUploaded: i >= this.maxPool ? i - this.maxPool : i,
            status: finish === chunks.length ? "finished" : "uploading",
            progress: (finish / chunks.length) * 100,
          });
        };

        // First Upload
        if (!id) {
          const { data: init } = await this.retry({
            fn: () => task,
            trying: 0,
          });

          [id, fileId] = [init._id, `${init.fileId}`];

          onSuccess();
        } else {
          task.then(() => {
            // Remove the Promise task from the concurrency pool when the request ends
            let index = pool.findIndex((t) => t === task);
            pool.splice(index);

            onSuccess();
          });

          // Concurrent pool
          // await retry(() => task)
          pool.push(this.retry({ fn: () => task, trying: 0 }) as UploadTask);
          if (i === chunks.length - 2 || pool.length === this.maxPool) {
            //All requests are requested complete
            await Promise.all(pool);
          }
        }
      }
    } catch (error) {
      console.log(error);
      cb({
        status: "error",
        errReason: (error as Error).toString(),
      });
    }
  };

  uploadFiles = async (
    files: FileList | File[],
    folderId?: string,
    onProgress?: (fileData: FileUpload[]) => void
  ) => {
    const currFilesUpload = this.filesUpload.length;

    Array.from(files).map((file, index) => {
      index = currFilesUpload > 0 ? index + currFilesUpload : index;

      const cbFunc = (data: Partial<FileUpload>) => {
        const currFilesUpload = this.updateFileUpload(index, data);
        onProgress?.(currFilesUpload);
      };

      const fileData: FileUpload = {
        name: file.name,
        type: file.type,
        size: file.size,
        status: "init",
        folderId,
        totalPart: Math.ceil(file.size / this.KBtoB(this.chunkSize)),
        remove: () => {
          this.updateFileUpload(index, { status: "finished" });
        },
        resume: () => {
          this.filesUpload[index].status = "uploading";

          this.sendChunks(
            this.filesUpload[index],
            file,
            this.filesUpload[index].partUploaded,
            cbFunc
          );
        },
      };

      this.filesUpload.push(fileData);

      onProgress?.(this.filesUpload);
      this.sendChunks(fileData, file, 0, cbFunc);
    });
  };

  // ============================== File Management ==============================

  private buildQuery = (
    user: User,
    filter?: FindOption<KotakCloudFile>
  ): [FindOption<KotakCloudFile>, FindOption<KotakCloudFile>] => {
    filter = {
      ...filter,
      where: {
        ...filter?.where,
      },
    };

    if (user.role !== "admin") {
      filter.where = {
        ...filter?.where,
        createdBy: user._id,
      };
    }

    let filterFiles = Object.assign({}, filter),
      filterFolders = Object.assign({}, filter);

    if (filter.where?.parentId || filter.where?.folder) {
      const parentId = filter.where?.parentId || filter.where?.folder;

      filterFiles.where = {
        ...filterFiles.where,
        folder: `${parentId}`,
      };
      filterFolders.where = {
        ...filterFolders.where,
        parentId: `${parentId}`,
      };

      delete filterFiles.where?.parentId;
      delete filterFolders.where?.folder;
    } else {
      filterFolders.where = {
        ...filter.where,
        parentId: "",
      };
    }

    if (filter.skip) {
      filterFiles.skip = filter.skip - this.currentTotal.folders;
      filterFolders.skip = filter.skip - this.currentTotal.files;
    }

    this.filesFilter = { ...filter };
    return [filterFiles, filterFolders];
  };

  createFolder = async ({
    name,
    parentId = "",
  }: {
    name: string;
    parentId?: string;
  }) => {
    return this.kontenbase
      .service<KotakCloudFile>("folders")
      .create({ name, parentId });
  };

  getBreadCrumbs = async (currPathId?: string): Promise<Breadcrumb[]> => {
    let breadcrumbs: Breadcrumb[] = [];

    const getItem = async (currId: string) => {
      const { data } = await this.kontenbase
        .service<Breadcrumb>("folders")
        .find({
          where: { _id: currId },
          select: ["_id", "name", "parentId"],
        });

      const currItem = data?.[0];

      if (currItem) {
        if (currItem.parentId) {
          await getItem(currItem.parentId);
        }

        breadcrumbs.push(currItem);
      }
    };

    if (typeof currPathId !== "undefined") await getItem(currPathId);
    return breadcrumbs;
  };

  getFiles = async (
    filter?: FindOption<KotakCloudFile>
  ): Promise<{
    total: number;
    data: KotakCloudFile[];
    error?: {
      message?: string;
    };
  }> => {
    const { user } = await this.user();

    if (!user) throw new Error("User not found!");

    filter = { ...this.filesFilter, ...filter };
    const parent = filter?.where?.parentId || filter?.where?.folder;
    const [filterFiles, filterFolders] = this.buildQuery(user, filter);

    const responses = await Promise.all([
      ...["files", "folders"].map((service) =>
        this.kontenbase
          .service<KotakCloudFile>(service)
          .find(service === "files" ? filterFiles : filterFolders)
      ),
      ...["files", "folders"].map(
        (service) =>
          this.kontenbase
            .service<KotakCloudFile>(service)
            .count(service === "files" ? filterFiles : filterFolders)
      ),
    ]);

    let [
      { data: files, ...filesResponse },
      { data: folders, ...foldersResponse },
      { data: filesCount },
      { data: foldersCount },
    ] = responses;

    files = files as KotakCloudFile[];
    folders = folders as KotakCloudFile[];
    filesCount = (filesCount as KontenbaseCount);
    foldersCount = (foldersCount as KontenbaseCount);

    if (
      files &&
      folders &&
      typeof filesCount?.count === "number" &&
      typeof foldersCount?.count === "number"
    ) {
      

      if (!parent) {
        let filteredCount = 0;
        files = files.filter((file: KotakCloudFile) => {
          const isRoot = !file.folder || file.folder?.length === 0;
          if (!isRoot) {
            filteredCount++;
          }

          return isRoot;
        });

        filesCount.count -= filteredCount;
      }

      this.currentTotal = {
        folders: folders.length,
        files: files.length - folders.length,
      };

      if (
        files.length + folders.length >
        Number(filter?.limit || this.filesFilter?.limit)
      ) {
        const start = files.length - folders.length;
        files.splice(start <= 0 ? 0 : start, folders.length);
      }

      return {
        total: foldersCount.count + filesCount.count,
        data: [
          ...folders.map((folder: KotakCloudFile) => ({
            ...folder,
            id: folder._id,
            info: `${folder.createdAt}`,
            meta: {
              name: folder.name,
              mimetype: "folder",
            },
          })),
          ...files.map((file: KotakCloudFile) => ({
            ...file,
            id: file._id,
            url: file?.url || `${this.url}/file/${file._id}`,
            meta: {
              name: file.name,
              mimetype: file.mimetype || "application/octet-stream",
            },
            info: file.messageId
              ? `${file.createdAt}`
              : `Uploading... (${file.progress?.toFixed(2)}%)`,
          })),
        ],
      };
    }

    return {
      total: 0,
      data: [],
      error: {
        message:
          (filesResponse as KontenbaseResponse<KotakCloudFile>)?.error
            ?.message ||
          (foldersResponse as KontenbaseResponse<KotakCloudFile>)?.error
            ?.message,
      },
    };
  };

  deleteFiles = async (
    files: KotakCloudFile[]
  ): Promise<{
    data: KotakCloudFile[];
    errors: { data: KotakCloudFile; reason: string }[];
  }> => {
    const fileIds: KotakCloudFile[] = [],
      folderIds: KotakCloudFile[] = [],
      sucessDeleted: KotakCloudFile[] = [],
      failedDeleted: {
        data: KotakCloudFile;
        reason: string;
      }[] = [];

    files.forEach((file) => {
      if (file?.meta?.mimetype.includes("folder") || !file.mimetype) {
        folderIds.push(file);
      } else {
        fileIds.push(file);
      }
    });

    const onResolve = (
      response: KontenbaseSingleResponse<KotakCloudFile>,
      data: KotakCloudFile
    ) => {
      if (response?.data) {
        sucessDeleted.push(response.data);
      }

      if (response?.error) {
        failedDeleted.push({
          data: data,
          reason: response.error.toString(),
        });
      }
    };

    const deleteFiles = Promise.all(
      fileIds.map(
        async (file) =>
          this.kontenbase
            .service<KotakCloudFile>("files")
            .deleteById(file._id || file.id)
            .then((res) => onResolve(res, file))
        // .updateById(id, { deletedAt: new Date().toISOString() })
      )
    );

    const deleteFolders = Promise.all(
      folderIds.map(
        async (folder) =>
          this.kontenbase
            .service<KotakCloudFile>("folders")
            .deleteById(folder._id || folder.id)
            .then((res) => onResolve(res, folder))
        // .updateById(id, { deletedAt: new Date().toISOString() })
      )
    );

    await Promise.all([deleteFiles, deleteFolders]);

    return {
      data: sucessDeleted,
      errors: failedDeleted,
    };
  };
}
