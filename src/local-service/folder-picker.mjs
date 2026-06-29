import path from "node:path";
import { execFile } from "node:child_process";

const folderTargets = {
  source: {
    title: { zh: "选择资料目录", en: "Choose Source Folder" },
    label: { zh: "资料目录", en: "Source folder" }
  },
  workspace: {
    title: { zh: "选择工作目录", en: "Choose Work Folder" },
    label: { zh: "工作目录", en: "Work folder" }
  }
};

export function isFolderPickerTarget(value) {
  return Object.hasOwn(folderTargets, value);
}

export async function pickLocalFolder(options = {}) {
  const target = String(options.target || "");
  if (!isFolderPickerTarget(target)) {
    return {
      ok: false,
      target,
      error: "Unsupported folder target."
    };
  }

  const meta = folderTargets[target];
  if (options.dryRun === true) {
    return {
      ok: true,
      target,
      title: meta.title,
      path: ""
    };
  }

  if (process.platform !== "win32") {
    return {
      ok: false,
      target,
      checks: [
        check(
          "folderPicker",
          "warn",
          "目录选择",
          "Folder picker",
          "当前系统暂不支持自动弹出目录选择，请直接粘贴路径。",
          "This system cannot open the folder picker yet. Paste the path manually."
        )
      ]
    };
  }

  try {
    const selectedPath = normalizePickedPath(await openWindowsFolderPicker(meta.title.zh));
    if (!selectedPath) {
      return {
        ok: false,
        target,
        canceled: true,
        checks: [
          check(
            "folderPicker",
            "warn",
            meta.label.zh,
            meta.label.en,
            "没有选择目录，可以继续手动粘贴路径。",
            "No folder was selected. You can paste the path manually."
          )
        ]
      };
    }

    return {
      ok: true,
      target,
      path: selectedPath,
      checks: [
        check(
          "folderPicker",
          "pass",
          meta.label.zh,
          meta.label.en,
          "已选择目录，草稿会保存在本机浏览器。",
          "Folder selected. The draft is saved in this browser."
        )
      ]
    };
  } catch {
    return {
      ok: false,
      target,
      checks: [
        check(
          "folderPicker",
          "warn",
          meta.label.zh,
          meta.label.en,
          "没有打开系统目录选择框，请直接粘贴路径。",
          "The system folder picker did not open. Paste the path manually."
        )
      ]
    };
  }
}

function openWindowsFolderPicker(title) {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class ModernFolderPicker
{
  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
  private class FileOpenDialog { }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("42f85136-db7e-439c-85f1-e4075d135fc8")]
  private interface IFileOpenDialog
  {
    [PreserveSig] int Show(IntPtr hwndOwner);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int fdap);
    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid(ref Guid guid);
    void ClearClientData();
    void SetFilter(IntPtr pFilter);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe")]
  private interface IShellItem
  {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, out IntPtr ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }

  [DllImport("ole32.dll")]
  private static extern void CoTaskMemFree(IntPtr pv);

  public const uint FOS_PICKFOLDERS = 0x00000020;
  public const uint FOS_FORCEFILESYSTEM = 0x00000040;
  public const uint FOS_NOCHANGEDIR = 0x00000008;
  public const uint FOS_PATHMUSTEXIST = 0x00000800;
  public const uint SIGDN_FILESYSPATH = 0x80058000;

  public static string Pick(string title, IntPtr owner)
  {
    IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialog();
    IShellItem item = null;
    IntPtr pathPtr = IntPtr.Zero;
    try
    {
      uint options;
      dialog.GetOptions(out options);
      dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_PATHMUSTEXIST);
      dialog.SetTitle(title);
      if (dialog.Show(owner) != 0) return "";
      dialog.GetResult(out item);
      item.GetDisplayName(SIGDN_FILESYSPATH, out pathPtr);
      return Marshal.PtrToStringUni(pathPtr);
    }
    finally
    {
      if (pathPtr != IntPtr.Zero) CoTaskMemFree(pathPtr);
      if (item != null) Marshal.ReleaseComObject(item);
      Marshal.ReleaseComObject(dialog);
    }
  }
}
"@
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'KnowMesh'
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0.01
try {
  $owner.Show()
  $owner.Activate()
  [ModernFolderPicker]::Pick('${escapePowerShellString(title)}', $owner.Handle)
} finally {
  $owner.Close()
  $owner.Dispose()
}
`;

  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: false,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      }
    );
  });
}

function normalizePickedPath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return path.normalize(trimmed);
}

function escapePowerShellString(value) {
  return String(value).replaceAll("'", "''");
}

function check(key, status, zhLabel, enLabel, zhMessage, enMessage) {
  return {
    key,
    status,
    label: { zh: zhLabel, en: enLabel },
    message: { zh: zhMessage, en: enMessage }
  };
}
