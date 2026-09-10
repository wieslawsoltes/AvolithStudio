/** Rebuild supported openNURBS trim edges on their original NURBS support surfaces.
 * Native ShapeFix projects p-curves; sewing and BRepCheck gates prevent promoting
 * incomplete trimmed surfaces into apparently valid solid objects.
 */
export function rebuild3dmBrep(r,oc,scope,data,surfaceFactory){
  if(!data||!Array.isArray(data.faces)||!data.faces.length||data.faces.length>512)throw Error('Invalid .3dm face set.');
  const own=x=>scope.own(x),arr=(Type,list)=>{const a=own(new Type(1,list.length));list.forEach((x,i)=>a.SetValue(i+1,x));return a;};
  let edgeCount=0;
  function edge(d){
    if(++edgeCount>8192||!Array.isArray(d.poles)||d.poles.length<2||d.poles.length>4096||!Number.isInteger(d.degree)||d.degree<1||d.degree>12||d.degree>=d.poles.length||!Array.isArray(d.weights)||d.weights.length!==d.poles.length||!d.weights.every(x=>Number.isFinite(x)&&x>0)||!Array.isArray(d.knots)||!Array.isArray(d.multiplicities)||d.knots.length!==d.multiplicities.length||d.knots.length<2||!d.knots.every((x,i)=>Number.isFinite(x)&&(i===0||x>d.knots[i-1]))||!d.multiplicities.every(x=>Number.isInteger(x)&&x>0&&x<=d.degree+1)||d.multiplicities.reduce((a,b)=>a+b,0)!==d.poles.length+d.degree+1)throw Error('Invalid .3dm NURBS trim curve.');
    const poles=own(new oc.NCollection_Array1_gp_Pnt(1,d.poles.length));d.poles.forEach((p,i)=>{if(!Array.isArray(p)||p.length!==3||!p.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e7))throw Error('Invalid trim control point.');poles.SetValue(i+1,own(new oc.gp_Pnt(...p)));});
    const curve=own(new oc.Geom_BSplineCurve(poles,arr(oc.NCollection_Array1_double,d.weights),arr(oc.NCollection_Array1_double,d.knots),arr(oc.NCollection_Array1_int,d.multiplicities),d.degree,false,true));const maker=own(new oc.BRepBuilderAPI_MakeEdge(curve));if(!maker.IsDone())throw Error('Native trim edge construction failed.');const e=own(maker.Edge());return own(r.cast(d.reverse?own(e.Reversed()):e));
  }
  const faces=[];
  for(const f of data.faces){
    if(!Array.isArray(f.wires)||!f.wires.length||f.wires.length>64)throw Error('Face without explicit trimming loops.');const surface=surfaceFactory(f.surface),fix=own(new oc.ShapeFix_Face());fix.Init(surface,1e-6,!f.reverse);fix.SetPrecision(1e-6);fix.SetMinTolerance(1e-7);fix.SetMaxTolerance(1e-4);
    for(const w of f.wires){if(!Array.isArray(w)||!w.length||w.length>512)throw Error('Invalid trim loop.');const wire=own(r.assembleWire(w.map(edge)));fix.Add(wire.wrapped);}
    fix.Perform();const shape=own(r.cast(fix.Result()));const a=own(new oc.BRepCheck_Analyzer(shape.wrapped,true,false));if(!a.IsValid())throw Error('Native trim projection did not produce a valid face. Use STEP for this object.');faces.push(shape);
  }
  const sewing=own(new oc.BRepBuilderAPI_Sewing(1e-5,true,true,true,false));for(const f of faces)sewing.Add(f.wrapped);sewing.Perform();let result=own(r.cast(sewing.SewedShape()));
  if(data.solid){if(result.constructor.name!=='Shell')throw Error('Imported closed .3dm B-rep did not sew into one shell.');const maker=own(new oc.BRepBuilderAPI_MakeSolid(result.wrapped));if(!maker.IsDone())throw Error('Cannot construct the imported solid.');const fixer=own(new oc.ShapeFix_Solid(maker.Solid()));fixer.Perform();result=own(r.cast(fixer.Solid()));}
  oc.BRepLib.SameParameter(result.wrapped,1e-6,true);
  return result;
}
