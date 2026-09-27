using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Accessibility;

// KuGou 20 exposes custom controls through MSAA while its UIA proxy can be empty.
public static class KugouAccessibility {
    delegate bool Callback(IntPtr handle, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr handle, uint id, ref Guid guid, [MarshalAs(UnmanagedType.Interface)] out object obj);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int actual);
    static readonly Regex TimeLabel = new Regex(@"^\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*/\s*(\d{1,3}:\d{2}(?::\d{2})?)\s*$");
    sealed class Node { public string Name=""; public int Role; public Node Parent; public IAccessible Accessible; public object ChildId; public List<Node> Children=new List<Node>(); }
    static Node cachedTime;
    static List<Node> cachedLinks;
    static IntPtr cachedHandle;
    static DateTime cachedAt;
    public sealed class Sample {
        public bool available=true;
        public string source="kugou-window", method="msaa", windowTitle;
        public string[] trackLabels;
        public int position, duration;
        public long readMs;
    }
    static Node Read(IAccessible accessible, object childId, Node parent, int depth, ref int budget) {
        if(depth>24 || --budget<0) return null;
        var node=new Node(); node.Parent=parent; node.Accessible=accessible; node.ChildId=childId;
        // Optional COM properties may throw independently of the name and children.
        try { node.Name=accessible.get_accName(childId) ?? ""; } catch { }
        try { node.Role=Convert.ToInt32(accessible.get_accRole(childId)); } catch { }
        if(!childId.Equals(0)) return node;
        int count=0; try { count=Math.Min(1000,accessible.accChildCount); } catch { }
        if(count<=0) return node;
        var children=new object[count]; int actual=0;
        try { AccessibleChildren(accessible,0,count,children,out actual); } catch { return node; }
        for(int i=0;i<actual;i++) {
            if(children[i]==null)continue;
            var child=children[i] as IAccessible;
            var next=child!=null?Read(child,0,node,depth+1,ref budget):Read(accessible,children[i],node,depth+1,ref budget);
            if(next!=null)node.Children.Add(next);
        }
        return node;
    }
    static void Links(Node node, List<Node> labels) {
        if(node.Role==30 && node.Name.Length>0)labels.Add(node);
        foreach(var child in node.Children)Links(child,labels);
    }
    static int Seconds(string text) { int seconds=0; foreach(var part in text.Split(':'))seconds=seconds*60+int.Parse(part); return seconds; }
    static Sample FindTime(Node node) {
        var match=TimeLabel.Match(node.Name);
        if(match.Success) {
            int position=Seconds(match.Groups[1].Value),duration=Seconds(match.Groups[2].Value);
            if(duration>0 && position<=duration) {
                // Identity comes only from the current playback strip, never playlist entries.
                var scope=node.Parent;
                for(int level=0;scope!=null && level<4;level++,scope=scope.Parent) {
                    var labels=new List<Node>(); Links(scope,labels);
                    if(labels.Count>0){cachedTime=node;cachedLinks=labels;cachedAt=DateTime.UtcNow;return new Sample {position=position,duration=duration,trackLabels=labels.ConvertAll(n=>n.Name).ToArray()};}
                }
            }
        }
        foreach(var child in node.Children) { var sample=FindTime(child); if(sample!=null)return sample; }
        return null;
    }
    public static Sample Read(int[] processIds) {
        var clock=Stopwatch.StartNew(); var pids=new HashSet<int>(processIds);var handles=new List<IntPtr>();
        EnumWindows((handle,data)=>{uint pid;GetWindowThreadProcessId(handle,out pid);if(pids.Contains((int)pid))handles.Add(handle);return true;},IntPtr.Zero);
        foreach(var handle in handles) {
            var title=new StringBuilder(1024);GetWindowText(handle,title,1024);
            if(!title.ToString().Contains("\u9177\u72d7") || title.ToString().Contains("\u684c\u9762\u6b4c\u8bcd"))continue;
            if(handle==cachedHandle && cachedTime!=null && (DateTime.UtcNow-cachedAt).TotalSeconds<20) {
                try {
                    var match=TimeLabel.Match(cachedTime.Accessible.get_accName(cachedTime.ChildId) ?? "");
                    var labels=cachedLinks.ConvertAll(n=>n.Accessible.get_accName(n.ChildId) ?? "");
                    if(match.Success && labels.TrueForAll(n=>n.Length>0)) {
                        int position=Seconds(match.Groups[1].Value),duration=Seconds(match.Groups[2].Value);
                        if(duration>0 && position<=duration)return new Sample {position=position,duration=duration,trackLabels=labels.ToArray(),windowTitle=title.ToString(),readMs=clock.ElapsedMilliseconds};
                    }
                } catch { }
            }
            object obj;var iid=new Guid("618736e0-3c3d-11cf-810c-00aa00389b71");
            if(AccessibleObjectFromWindow(handle,0xFFFFFFFC,ref iid,out obj)!=0 || !(obj is IAccessible))continue;
            int budget=5000;var root=Read((IAccessible)obj,0,null,0,ref budget);
            var sample=root==null?null:FindTime(root);
            if(sample!=null){cachedHandle=handle;sample.windowTitle=title.ToString();sample.readMs=clock.ElapsedMilliseconds;return sample;}
        }
        return null;
    }
}
