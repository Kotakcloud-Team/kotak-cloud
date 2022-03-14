import { AxiosResponse } from "axios";
export { FindOption } from "@kontenbase/sdk";

export type UploadTask = Promise<AxiosResponse<KotakCloudFile, any>>;

export interface KotakCloudClientOptions {
  url?: string;
  token?: string | null;
  maxRetry?: number;
  chunkSize?: number;
  maxPool?: number;
  apiVersion?: "v1";
}

export interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: "authenticated" | "admin";
  password?: string;
}

export interface FileUpload {
  name: string;
  type: string;
  size: number;
  status: "init" | "uploading" | "finished" | "error";
  file?: File;
  totalPart?: number;
  partUploaded?: number;
  progress?: number;
  index?: number;
  id?: string;
  fileId?: string;
  folderId?: string;
  errReason?: string;
  resume: () => void;
  remove: () => void;
}

export interface Chunk {
  hash: number;
  chunk: Blob;
  errReason?: string;
}

export interface Retry {
  fn: () => UploadTask;
  trying?: number;
  tryingBatch?: number;
  cb?: (
    fn: Retry["fn"],
    err: { code: number; message: string },
    trying?: number
  ) => void;
}

export interface Meta {
  name: string;
  mimetype: string;
}

export interface Breadcrumb {
  _id: string;
  name: string;
  parentId?: string;
}

export interface KotakCloudFile extends Meta {
  id: string;
  _id: string;
  size?: number;
  messageId?: number;
  url?: string;
  folder?: string | string[];
  parentId?: string;
  progress?: number;
  meta?: Meta;
  info?: string;
  fileId?: string;
  deletedAt?: Date | string;
  createdAt?: Date | string;
  createdBy?: string | User;
}

export interface AuthComponent {
  isAuthenticated?: boolean;
}
