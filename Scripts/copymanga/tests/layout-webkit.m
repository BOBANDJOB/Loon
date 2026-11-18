#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
@interface Check : NSObject<WKNavigationDelegate>
@property WKWebView *web;
@property NSString *script;
@end
@implementation Check
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation {
 (void)navigation;
 [web evaluateJavaScript:@"window.scrollTo(0,document.documentElement.scrollHeight);0" completionHandler:^(id value,NSError *error) {
  (void)value;(void)error;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,200*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
   NSString *js=@"JSON.stringify((()=>{const el=document.querySelector('#info_count'),p=document.querySelector('#info'),sb=document.querySelector('#sidebar');const range=document.createRange();range.selectNodeContents(el);const r=el.getBoundingClientRect(),t=range.getBoundingClientRect(),outer=p.getBoundingClientRect();const box=r=>({top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height});return {counter:box(r),text:box(t),outer:box(outer),style:{display:getComputedStyle(el).display,font:getComputedStyle(el).font,lineHeight:getComputedStyle(el).lineHeight,padding:getComputedStyle(p).padding},sidebar:sb?box(sb.getBoundingClientRect()):null,innerWidth:innerWidth,innerHeight:innerHeight,overflow:t.top<r.top-1||t.bottom>r.bottom+1,centerDelta:Math.abs((r.top+r.bottom-t.top-t.bottom)/2)}})())";
   [web evaluateJavaScript:self.script?:js completionHandler:^(id result,NSError *err){if(err){fprintf(stderr,"%s\n",err.description.UTF8String);exit(2);}puts([result UTF8String]);exit(0);}];
  });
 }];
}
- (void)webView:(WKWebView *)web didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error { (void)web;(void)navigation;fprintf(stderr,"%s\n",error.description.UTF8String);exit(2); }
@end
int main(int argc,const char **argv) {
 @autoreleasepool {
  if(argc!=4 && argc!=5)return 2;
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  Check *delegate=[Check new];WKWebViewConfiguration *config=[WKWebViewConfiguration new];config.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];delegate.web=[[WKWebView alloc]initWithFrame:NSMakeRect(0,0,atof(argv[2]),atof(argv[3])) configuration:config];delegate.web.navigationDelegate=delegate;
  if(argc==5)delegate.script=[NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[4]] encoding:NSUTF8StringEncoding error:nil];
  NSString *html=[NSString stringWithContentsOfFile:[NSString stringWithUTF8String:argv[1]] encoding:NSUTF8StringEncoding error:nil];
  [delegate.web loadHTMLString:html baseURL:[NSURL URLWithString:@"https://fixtures.invalid/"]];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,15*NSEC_PER_SEC),dispatch_get_main_queue(),^{fputs("WebKit test timeout\n",stderr);exit(3);});
  [NSApp run];
 }
 return 0;
}
