param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [string]$Icon,
    [switch]$VerifyOnly,
    [switch]$AllowOtherIcons
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if (-not $Icon) { $Icon = Join-Path $root 'public\brand\app.ico' }
$target = [IO.Path]::GetFullPath($Executable)
$iconPath = [IO.Path]::GetFullPath($Icon)
if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or -not (Test-Path -LiteralPath $iconPath -PathType Leaf)) { throw 'Icon or executable not found.' }
if (-not $VerifyOnly) {
    $allowed = @((Join-Path $root 'release'), (Join-Path $root '.cache'))
    if (-not ($allowed | Where-Object { $target.StartsWith($_ + '\', [StringComparison]::OrdinalIgnoreCase) })) { throw 'Only unpublished release or cache copies may be modified.' }
    $cursor = Split-Path -Parent $target
    while ($cursor.Length -ge $root.Length) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Executable ancestors cannot be directory links.' }
        $manifestFile = Join-Path $cursor ((-join [char[]](0x53D1,0x5E03,0x6E05,0x5355)) + '.json')
        if (Test-Path -LiteralPath $manifestFile) {
            $existing = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($existing.PSObject.Properties.Name -contains 'finalizedAt') { throw 'Finalized release icons must not be modified.' }
        }
        $cursor = Split-Path -Parent $cursor
    }
    if ((Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The executable cannot be a link.' }
}

# Windows' own resource APIs. LoadLibraryEx uses data-only loading, never runs the target.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;

public static class KxWindowsIcon {
    delegate bool NameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
    delegate bool LanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr LoadLibraryEx(string file, IntPtr handle, uint flags);
    [DllImport("kernel32.dll")] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, NameCallback callback, IntPtr param);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, LanguageCallback callback, IntPtr param);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr FindResourceEx(IntPtr module, IntPtr type, IntPtr name, ushort language);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
    class Resource { public int Type; public int Id; public string Name; public ushort Language; }
    class Frame { public byte[] Header; public byte[] Data; public int Size; }
    public class Result { public string Executable; public int[] Sizes; public int MatchingGroups; public int TotalGroups; public int IconResources; public bool Passed; }
    static IntPtr NamePointer(Resource value) { return value.Name == null ? new IntPtr(value.Id) : Marshal.StringToHGlobalUni(value.Name); }
    static void FreeName(Resource value, IntPtr pointer) { if (value.Name != null) Marshal.FreeHGlobal(pointer); }
    static Exception Error(string message) { return new Win32Exception(Marshal.GetLastWin32Error(), message); }
    static List<Resource> Resources(IntPtr module, int type) {
        var result = new List<Resource>();
        NameCallback names = (m, t, name, p) => {
            bool numeric = ((ulong)name.ToInt64() >> 16) == 0;
            int id = numeric ? name.ToInt32() : 0;
            string text = numeric ? null : Marshal.PtrToStringUni(name);
            LanguageCallback languages = (lm, lt, ln, lang, lp) => { result.Add(new Resource { Type=type, Id=id, Name=text, Language=lang }); return true; };
            if (!EnumResourceLanguages(m, t, name, languages, IntPtr.Zero)) throw Error("Cannot enumerate icon languages");
            GC.KeepAlive(languages); return true;
        };
        bool success = EnumResourceNames(module, new IntPtr(type), names, IntPtr.Zero);
        int code = Marshal.GetLastWin32Error(); GC.KeepAlive(names);
        if (!success && code != 1813 && code != 1814) throw new Win32Exception(code, "Cannot enumerate icons");
        return result;
    }
    static byte[] ReadResource(IntPtr module, Resource value) {
        IntPtr name = NamePointer(value);
        try {
            IntPtr resource = FindResourceEx(module, new IntPtr(value.Type), name, value.Language);
            if (resource == IntPtr.Zero) throw Error("Missing icon resource");
            uint length = SizeofResource(module, resource);
            IntPtr bytes = LockResource(LoadResource(module, resource));
            if (bytes == IntPtr.Zero || length == 0) throw Error("Empty icon resource");
            var data = new byte[length]; Marshal.Copy(bytes, data, 0, checked((int)length)); return data;
        } finally { FreeName(value, name); }
    }
    static List<Frame> ReadIcon(string file) {
        var bytes = File.ReadAllBytes(file); var result = new List<Frame>();
        using (var reader = new BinaryReader(new MemoryStream(bytes))) {
            if (reader.ReadUInt16()!=0 || reader.ReadUInt16()!=1) throw new InvalidDataException("Not an ICO file");
            int count=reader.ReadUInt16();
            if (count<1 || count>32 || bytes.Length<6+count*16) throw new InvalidDataException("Invalid icon count");
            for (int i=0;i<count;i++) {
                byte[] header=reader.ReadBytes(8); uint length=reader.ReadUInt32(); uint offset=reader.ReadUInt32();
                if (length<8 || (ulong)offset+length>(ulong)bytes.Length || offset<6+count*16) throw new InvalidDataException("Invalid icon frame");
                var data=new byte[length]; Buffer.BlockCopy(bytes, checked((int)offset), data, 0, checked((int)length));
                result.Add(new Frame { Header=header, Data=data, Size=header[0]==0 ? 256 : header[0] });
            }
        }
        if (result.Select(f=>f.Size).Distinct().Count()!=result.Count) throw new InvalidDataException("Duplicate icon sizes");
        return result;
    }
    public static Result Verify(string file, string icon, bool exact) {
        var frames=ReadIcon(icon); IntPtr module=LoadLibraryEx(file, IntPtr.Zero, 2);
        if (module==IntPtr.Zero) throw Error("Cannot load executable as data");
        try {
            var groups=Resources(module,14); var icons=Resources(module,3); int matches=0;
            foreach(var group in groups) {
                var data=ReadResource(module,group); bool match=data.Length==6+frames.Count*14;
                if (!match) continue;
                using(var reader=new BinaryReader(new MemoryStream(data))) {
                    match=reader.ReadUInt16()==0 && reader.ReadUInt16()==1 && reader.ReadUInt16()==frames.Count;
                    for(int i=0;match && i<frames.Count;i++) {
                        var header=reader.ReadBytes(8); uint length=reader.ReadUInt32(); int id=reader.ReadUInt16();
                        var resource=icons.FirstOrDefault(r=>r.Id==id && r.Name==null && r.Language==group.Language);
                        match=resource!=null && header.SequenceEqual(frames[i].Header) && length==frames[i].Data.Length && ReadResource(module,resource).SequenceEqual(frames[i].Data);
                    }
                }
                if(match) matches++;
            }
            bool passed=matches>0 && (!exact || (matches==groups.Count && icons.Count==frames.Count));
            if(!passed) throw new InvalidDataException("Executable icon does not match the approved multi-size ICO");
            return new Result { Executable=file, Sizes=frames.Select(f=>f.Size).ToArray(), MatchingGroups=matches, TotalGroups=groups.Count, IconResources=icons.Count, Passed=true };
        } finally { FreeLibrary(module); }
    }
    public static Result Replace(string file, string icon) {
        var frames=ReadIcon(icon); IntPtr module=LoadLibraryEx(file, IntPtr.Zero, 2);
        if(module==IntPtr.Zero) throw Error("Cannot load executable as data");
        List<Resource> old;
        try { old=Resources(module,14).Concat(Resources(module,3)).ToList(); } finally { FreeLibrary(module); }
        IntPtr update=BeginUpdateResource(file,false);
        if(update==IntPtr.Zero) throw Error("Cannot open executable resources for update");
        bool committed=false;
        try {
            foreach(var item in old) {
                IntPtr name=NamePointer(item);
                try { if(!UpdateResource(update,new IntPtr(item.Type),name,item.Language,null,0)) throw Error("Cannot remove old icon"); }
                finally { FreeName(item,name); }
            }
            using(var stream=new MemoryStream()) using(var writer=new BinaryWriter(stream)) {
                writer.Write((ushort)0); writer.Write((ushort)1); writer.Write((ushort)frames.Count);
                for(int i=0;i<frames.Count;i++) {
                    var frame=frames[i];
                    if(!UpdateResource(update,new IntPtr(3),new IntPtr(i+1),0,frame.Data,(uint)frame.Data.Length)) throw Error("Cannot write icon frame");
                    writer.Write(frame.Header); writer.Write((uint)frame.Data.Length); writer.Write((ushort)(i+1));
                }
                writer.Flush(); var group=stream.ToArray();
                if(!UpdateResource(update,new IntPtr(14),new IntPtr(1),0,group,(uint)group.Length)) throw Error("Cannot write icon group");
            }
            if(!EndUpdateResource(update,false)) throw Error("Cannot commit executable resources");
            committed=true;
        } finally { if(!committed) EndUpdateResource(update,true); }
        return Verify(file,icon,true);
    }
}
'@
if ($VerifyOnly) { $result = [KxWindowsIcon]::Verify($target, $iconPath, (-not $AllowOtherIcons)) }
else { $result = [KxWindowsIcon]::Replace($target, $iconPath) }
$result | ConvertTo-Json
