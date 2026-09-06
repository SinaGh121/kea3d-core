// Authored regression fixture: body color, shell override, face override, and an uncolored body.
#include <BRepPrimAPI_MakeBox.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <TDocStd_Document.hxx>
#include <TopExp_Explorer.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <TDataStd_Name.hxx>
#include <Quantity_Color.hxx>

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  Handle(TDocStd_Document) doc = new TDocStd_Document("XmlXCAF");
  auto shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  auto colors = XCAFDoc_DocumentTool::ColorTool(doc->Main());
  const TopoDS_Shape box = BRepPrimAPI_MakeBox(10, 20, 30).Shape();
  const TDF_Label root = shapes->AddShape(box, false);
  TDataStd_Name::Set(root, "BodyShellFace");
  colors->SetColor(root, Quantity_Color(0, 0, 1, Quantity_TOC_RGB), XCAFDoc_ColorSurf);
  TopExp_Explorer shells(box, TopAbs_SHELL);
  const TDF_Label shell = shapes->AddSubShape(root, shells.Current());
  colors->SetColor(shell, Quantity_Color(1, 0, 0, Quantity_TOC_RGB), XCAFDoc_ColorSurf);
  TopExp_Explorer faces(box, TopAbs_FACE);
  const TDF_Label face = shapes->AddSubShape(root, faces.Current());
  colors->SetColor(face, Quantity_Color(0, 1, 0, Quantity_TOC_RGB), XCAFDoc_ColorSurf);
  const TDF_Label plain = shapes->AddShape(BRepPrimAPI_MakeBox(gp_Pnt(40, 0, 0), 10, 20, 30).Shape(), false);
  TDataStd_Name::Set(plain, "Uncolored");
  STEPCAFControl_Writer writer;
  writer.SetColorMode(true);
  writer.SetNameMode(true);
  if (!writer.Transfer(doc, STEPControl_AsIs)) return 3;
  return writer.Write(argv[1]) == IFSelect_RetDone ? 0 : 4;
}
