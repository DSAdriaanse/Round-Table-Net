import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

// The rich-text box used for scripts and announcements, styled for the dark theme.
// Produces HTML. Used by the nets screen and the announcements screen.
const modules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline"],
    ["blockquote"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link"],
    ["clean"],
  ],
};

export default function RichTextEditor({ value, onChange, placeholder }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  return (
    <div className="quill-dark mt-1">
      <ReactQuill theme="snow" value={value} onChange={onChange} modules={modules} placeholder={placeholder} />
    </div>
  );
}
